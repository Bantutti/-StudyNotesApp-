/**
 * Flow controller end to end with the fake adapter (ALGORITHMS §3; Plan
 * Flow 4). Every test uses a fetch that throws, so real network use fails.
 *
 * Covered: first run (age -> key -> consent -> run -> preview -> apply),
 * under 18, consent "Not now", key test failure keeps the old key, Cancel,
 * invalid output, rate limit + switch provider, offline, subject blocked,
 * partial accept, Explain/cards guards, one flow at a time, reports, and the
 * "never logs the key" check across every path.
 */
import { listBlockIds } from '@/core';
import { AiError } from '@/modules/ai';

import { visibleActions } from '../flow/controller';
import { bid, flowWorld, flush, GROQ_KEY, MISTRAL_KEY, noteDoc, replaceAnswer } from './helpers';

/** Starts a flow and returns its promise plus a settled-state probe. */
function open(w: Awaited<ReturnType<typeof flowWorld>>, over: Parameters<typeof w.ctx>[0] = {}, aiAllowed = true) {
  const settled: { value?: unknown; error?: unknown } = {};
  const p = w.ui.flow.start(w.ctx(over), aiAllowed).then(
    (v) => (settled.value = v),
    (e) => (settled.error = e),
  );
  return { p, settled };
}

const step = (w: Awaited<ReturnType<typeof flowWorld>>) => w.ui.flow.getSnapshot().step;

describe('first run: age -> key -> consent -> run -> preview -> apply', () => {
  it('asks each gate once, in order, then applies with ids preserved', async () => {
    const w = await flowWorld();
    const { p, settled } = open(w);
    await flush();
    expect(step(w).name).toBe('actions'); // the sheet first, gates when an action is picked

    await w.ui.flow.chooseAction('beautify');
    expect(step(w).name).toBe('age');
    await w.ui.flow.answerAge(true);
    expect(step(w)).toEqual({ name: 'key', provider: 'groq', replacing: false });

    const saved = await w.ui.flow.saveKey('groq', `  ${GROQ_KEY}  `); // pasted with spaces
    expect(saved).toEqual({ kind: 'saved' });
    expect(await w.vault.get('groq')).toBe(GROQ_KEY);
    expect(step(w)).toEqual({ name: 'consent', provider: 'groq' });
    expect(w.groq.calls).toHaveLength(0); // nothing sent before consent

    await w.ui.flow.answerConsent(true);
    await flush();
    expect(step(w).name).toBe('preview');
    expect(w.groq.calls).toHaveLength(1);
    const snap = w.ui.flow.getSnapshot();
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]).toMatchObject({ kind: 'replace', beforeText: 'the mitochondria makes energy', afterText: 'The mitochondria makes energy.' });
    expect(snap.accepted.size).toBe(1);

    await w.ui.flow.apply();
    await p;
    const result = settled.value as { doc: ReturnType<typeof noteDoc>; message: string };
    expect(result.message).toBe('Beautify: 1 change applied');
    expect(listBlockIds(result.doc)).toEqual(listBlockIds(noteDoc())); // same ids
    expect(JSON.stringify(result.doc)).toContain('mitochondria');
    expect(step(w).name).toBe('closed');
    expect(w.fetchFn).not.toHaveBeenCalled();
  });

  it('a second run asks nothing again (answers are stored)', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true });
    const { p } = open(w);
    await flush();
    await w.ui.flow.chooseAction('beautify');
    await flush();
    expect(step(w).name).toBe('preview');
    w.ui.flow.close();
    await p;
  });
});

describe('gates that stop before anything is sent', () => {
  it('under 18: calm panel, the engine is never called', async () => {
    const w = await flowWorld({ groqKey: true, consent: true });
    const { p, settled } = open(w);
    await flush();
    await w.ui.flow.chooseAction('summarize');
    await w.ui.flow.answerAge(false);
    expect(step(w)).toEqual({ name: 'minor', recheckAvailable: false });
    expect(w.groq.calls).toHaveLength(0);
    w.ui.flow.close();
    await p;
    expect(settled.error).toMatchObject({ code: 'cancelled' });
    // Next time the panel shows at once, without asking again.
    const again = open(w);
    await flush();
    expect(step(w).name).toBe('minor');
    w.ui.flow.close();
    await again.p;
  });

  it('consent "Not now": back to the sheet, nothing sent', async () => {
    const w = await flowWorld({ adult: true, groqKey: true });
    const { p } = open(w);
    await flush();
    await w.ui.flow.chooseAction('beautify');
    expect(step(w).name).toBe('consent');
    await w.ui.flow.answerConsent(false);
    expect(step(w)).toEqual({ name: 'actions', notice: 'not_sent' });
    expect(w.groq.calls).toHaveLength(0);
    expect(await w.ui.gate.hasConsent('groq', 1, 'text')).toBe(false);
    w.ui.flow.close();
    await p;
  });

  it('subject with AI off: blocked panel, nothing sent', async () => {
    const w = await flowWorld({ adult: true, groqKey: true, consent: true });
    const { p, settled } = open(w, {}, false);
    await flush();
    expect(step(w).name).toBe('blocked');
    await w.ui.flow.chooseAction('beautify'); // ignored path still can't send
    expect(w.groq.calls).toHaveLength(0);
    w.ui.flow.close();
    await p;
    expect(settled.error).toMatchObject({ code: 'cancelled' });
  });
});

describe('key wizard', () => {
  it('opening the wizard before the age check asks the age first', async () => {
    const w = await flowWorld();
    const { p } = open(w);
    await flush();
    await w.ui.flow.openKey('groq', false);
    expect(step(w).name).toBe('age');
    await w.ui.flow.answerAge(false);
    expect(step(w).name).toBe('minor');
    await w.ui.flow.openKey('groq', false);
    expect(step(w).name).toBe('minor');
    w.ui.flow.close();
    await p;
  });

  it('a rejected key never replaces a working one', async () => {
    const w = await flowWorld({ adult: true, groqKey: true });
    const { p } = open(w);
    await flush();
    await w.ui.flow.openKey('groq', true);
    w.groq.keyTest = { ok: false, reason: 'invalid_key' };
    const r = await w.ui.flow.saveKey('groq', 'gsk_' + 'X'.repeat(40));
    expect(r).toEqual({ kind: 'rejected' });
    expect(await w.vault.get('groq')).toBe(GROQ_KEY);
    w.ui.flow.close();
    await p;
  });

  it('a malformed key is refused before any request', async () => {
    const w = await flowWorld({ adult: true });
    const { p } = open(w);
    await flush();
    await w.ui.flow.openKey('groq', false);
    const r = await w.ui.flow.saveKey('groq', 'https://console.groq.com/keys');
    expect(r.kind).toBe('bad_format');
    expect(await w.vault.has('groq')).toBe(false);
    w.ui.flow.close();
    await p;
  });

  it('offline during the test: "unchecked", then Save anyway stores it', async () => {
    const w = await flowWorld({ adult: true });
    const { p } = open(w);
    await flush();
    await w.ui.flow.openKey('mistral', false);
    w.mistral.keyTest = new AiError('offline', { providerLabel: 'Mistral' });
    const r = await w.ui.flow.saveKey('mistral', MISTRAL_KEY);
    expect(r.kind).toBe('unchecked');
    expect(await w.vault.has('mistral')).toBe(false);
    expect(await w.ui.flow.saveKey('mistral', MISTRAL_KEY, true)).toEqual({ kind: 'saved' });
    expect(await w.vault.get('mistral')).toBe(MISTRAL_KEY);
    w.ui.flow.close();
    await p;
  });
});

describe('running and errors', () => {
  it('Cancel mid-run: back to the sheet, nothing changed', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true, steps: [replaceAnswer('u2', 'x')] });
    // Make the fake wait until aborted.
    w.groq.complete = (_req, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new AiError('cancelled')));
      });
    const { p, settled } = open(w);
    await flush();
    const chosen = w.ui.flow.chooseAction('beautify');
    await flush();
    expect(step(w).name).toBe('running');
    w.ui.flow.cancelRun();
    await chosen;
    await flush();
    expect(step(w)).toEqual({ name: 'actions', notice: 'cancelled' });
    w.ui.flow.close();
    await p;
    expect(settled.error).toMatchObject({ code: 'cancelled' });
  });

  it('invalid output twice: error with Retry, note untouched', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true, steps: [{ content: 'not json' }] });
    const { p, settled } = open(w);
    await flush();
    await w.ui.flow.chooseAction('beautify');
    await flush();
    const s = step(w);
    expect(s.name).toBe('error');
    if (s.name !== 'error') throw new Error('unreachable');
    expect(s.error).toMatchObject({ kind: 'invalid_output', next: 'retry' });
    expect(s.error.message).toMatch(/Groq's answer didn't make sense twice/);
    expect(w.groq.calls).toHaveLength(2); // one automatic re-ask (P3a Q6)
    w.ui.flow.close();
    await p;
    expect(settled.value).toBeUndefined();
  });

  it('rate limit with another keyed provider: "Use Mistral instead" re-runs there', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true, mistralKey: true });
    w.groq.setScript([{ error: new AiError('rate_limited', { providerLabel: 'Groq', scope: 'day', retryAfterMs: 20 * 60_000 }) }]);
    const { p } = open(w);
    await flush();
    await w.ui.flow.chooseAction('beautify');
    await flush();
    const s = step(w);
    if (s.name !== 'error') throw new Error(`expected error, got ${s.name}`);
    expect(s.error).toMatchObject({ kind: 'rate_limited', next: 'switch_provider', switchTo: 'mistral' });
    expect(s.error.message).toBe('Your free Groq limit is used up for now. Try again in about 20 minutes, or switch provider.');
    await w.ui.flow.nextStep();
    await flush();
    expect(step(w).name).toBe('preview');
    expect(w.ui.flow.getSnapshot().provider).toBe('mistral');
    expect(w.mistral.calls).toHaveLength(1);
    w.ui.flow.close();
    await p;
  });

  it('rate limit with no other key: one plain next step (OK)', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true });
    w.groq.setScript([{ error: new AiError('rate_limited', { providerLabel: 'Groq', scope: 'minute' }) }]);
    const { p } = open(w);
    await flush();
    await w.ui.flow.chooseAction('summarize');
    await flush();
    const s = step(w);
    if (s.name !== 'error') throw new Error('expected error');
    expect(s.error.next).toBe('ok');
    w.ui.flow.close();
    await p;
  });

  it('offline: "Needs internet" with the Beautify Lite next step', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true, steps: [{ error: new AiError('offline', { providerLabel: 'Groq' }) }] });
    const { p } = open(w);
    await flush();
    await w.ui.flow.chooseAction('beautify');
    await flush();
    const s = step(w);
    if (s.name !== 'error') throw new Error('expected error');
    expect(s.error).toMatchObject({ kind: 'offline', next: 'beautify_lite', message: 'Needs internet. You can still use Beautify Lite.' });
    await w.ui.flow.nextStep(); // closes
    await p;
    expect(step(w).name).toBe('closed');
  });

  it('bad key during a run: Replace key opens the wizard for that provider', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true, steps: [{ error: new AiError('invalid_key', { providerLabel: 'Groq', status: 401 }) }] });
    const { p } = open(w);
    await flush();
    await w.ui.flow.chooseAction('beautify');
    await flush();
    await w.ui.flow.nextStep();
    expect(step(w)).toEqual({ name: 'key', provider: 'groq', replacing: true });
    w.ui.flow.close();
    await p;
  });
});

describe('preview', () => {
  const two = { json: { units: [
    { ref: 'u2', op: 'replace', blocks: [{ kind: 'paragraph', term: null, text: 'Mitochondria make energy.' }] },
    { ref: 'u3', op: 'replace', blocks: [{ kind: 'paragraph', term: null, text: 'Osmosis moves water.' }] },
  ] } };

  it('partial accept: only accepted blocks change, every id kept', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true, steps: [two] });
    const { p, settled } = open(w);
    await flush();
    await w.ui.flow.chooseAction('clarify');
    await flush();
    const rows = w.ui.flow.getSnapshot().rows;
    expect(rows).toHaveLength(2);
    w.ui.flow.toggle(rows[0]!.changeId); // turn off the first change
    expect(w.ui.flow.getSnapshot().accepted.size).toBe(1);
    await w.ui.flow.apply();
    await p;
    const out = (settled.value as { doc: ReturnType<typeof noteDoc> }).doc;
    const text = JSON.stringify(out);
    expect(text).toContain('the mitochondria makes energy'); // unchanged
    expect(text).toContain('Osmosis moves water.'); // accepted
    expect(listBlockIds(out)).toEqual([bid(1), bid(2), bid(3)]);
  });

  it('Accept all off then Apply does nothing; Discard returns to the sheet', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true, steps: [two] });
    const { p } = open(w);
    await flush();
    await w.ui.flow.chooseAction('clarify');
    await flush();
    w.ui.flow.acceptAll(false);
    expect(w.ui.flow.getSnapshot().accepted.size).toBe(0);
    await w.ui.flow.apply(); // nothing accepted = discard
    expect(step(w)).toEqual({ name: 'actions', notice: 'discarded' });
    w.ui.flow.close();
    await p;
  });

  it('an empty proposal shows "Nothing to change"', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true, steps: [{ json: { units: [] } }] });
    const { p } = open(w);
    await flush();
    await w.ui.flow.chooseAction('beautify');
    await flush();
    expect(step(w).name).toBe('empty');
    w.ui.flow.close();
    await p;
  });

  it('Report saves a local record (metadata only) and sends nothing', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true });
    const { p } = open(w);
    await flush();
    await w.ui.flow.chooseAction('beautify');
    await flush();
    w.ui.flow.openReport();
    expect(step(w)).toEqual({ name: 'report', from: 'preview' });
    await w.ui.flow.submitReport('wrong', 'it invented a fact');
    expect(step(w).name).toBe('preview');
    expect(w.ui.flow.getSnapshot().reported).toBe(true);
    const [r] = await w.ui.reports.list();
    expect(r).toMatchObject({ action: 'beautify', provider: 'groq', reason: 'wrong', comment: 'it invented a fact', promptVersion: 'beautify@1.base@1' });
    expect(JSON.stringify(r)).not.toContain('mitochondria'); // no note text
    expect(w.groq.calls).toHaveLength(1); // the run itself; the report sent nothing
    expect(w.fetchFn).not.toHaveBeenCalled();
    w.ui.flow.close();
    await p;
  });
});

describe('guards', () => {
  it('Flashcards and Quiz me are hidden until P4c and cannot be started', async () => {
    expect(visibleActions()).not.toContain('flashcards');
    expect(visibleActions()).not.toContain('quiz');
    const w = await flowWorld({ adult: true, consent: true, groqKey: true });
    const { p } = open(w);
    await flush();
    await w.ui.flow.chooseAction('flashcards');
    expect(step(w).name).toBe('actions');
    expect(w.groq.calls).toHaveLength(0);
    w.ui.flow.close();
    await p;
  });

  it('Explain needs a selection; with one, only the selected blocks are sent', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true, steps: [{ json: { paragraphs: ['Mitochondria turn food into energy.'] } }] });
    const first = open(w);
    await flush();
    await w.ui.flow.chooseAction('explain'); // no selection: ignored
    expect(step(w).name).toBe('actions');
    w.ui.flow.close();
    await first.p;

    const second = open(w, { selection: [bid(2)] });
    await flush();
    expect(w.ui.flow.getSnapshot().scope).toBe('selection');
    await w.ui.flow.chooseAction('explain');
    await flush();
    expect(step(w).name).toBe('preview');
    const sent = w.groq.calls[0]!.req.user;
    expect(sent).toContain('mitochondria');
    expect(sent).not.toContain('osmosis');
    w.ui.flow.close();
    await second.p;
  });

  it('only one flow at a time', async () => {
    const w = await flowWorld();
    const a = open(w);
    await flush();
    await expect(w.ui.flow.start(w.ctx(), true)).rejects.toMatchObject({ code: 'cancelled' });
    w.ui.flow.close();
    await a.p;
  });
});

describe('secrets never reach the logs', () => {
  it('across success, rejection, rate limit and invalid output', async () => {
    const w = await flowWorld({ adult: true, consent: true });
    const { p } = open(w);
    await flush();
    await w.ui.flow.openKey('groq', false);
    w.groq.keyTest = { ok: false, reason: 'invalid_key' };
    await w.ui.flow.saveKey('groq', GROQ_KEY);
    w.groq.keyTest = { ok: true };
    await w.ui.flow.saveKey('groq', GROQ_KEY);
    await w.ui.flow.chooseAction('beautify');
    await flush();
    w.groq.setScript([{ error: new AiError('rate_limited', { providerLabel: 'Groq', scope: 'minute' }) }]);
    w.ui.flow.discard();
    await w.ui.flow.chooseAction('beautify');
    await flush();
    w.groq.setScript([{ content: 'nope' }]);
    await w.ui.flow.nextStep();
    await flush();
    w.ui.flow.close();
    await p;
    const dump = w.log.dump();
    expect(dump.length).toBeGreaterThan(0);
    expect(dump).not.toContain(GROQ_KEY);
    expect(dump).not.toContain(GROQ_KEY.slice(4, 20));
    expect(dump).not.toContain('mitochondria'); // no note content either
    // Nor the gate or report files.
    for (const f of w.files.values()) expect(f.content ?? '').not.toContain(GROQ_KEY);
  });
});
