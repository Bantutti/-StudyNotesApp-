/**
 * Engine end to end with the fake adapter (exit criteria: success, invalid
 * output, rate limit, bad key and offline), plus gates, fallback, cancel,
 * chunking and the usage meter.
 */
import { listBlockIds, type NoteDoc } from '@/core';

import { createAiEngine, type AiEngineDeps, type RunProgress } from '../engine';
import { AiError } from '../errors';
import { applyProposal, undoApply } from '../proposal/apply';
import { createFakeProvider, type FakeProvider, type FakeStep } from '../providers/fake';
import { bid, doc, memFile, p, sampleDoc, seededIds, testLogger, vaultWithKeys } from './fixtures';

async function setup(steps: FakeStep[], over: Partial<AiEngineDeps> = {}) {
  const { vault } = await vaultWithKeys();
  const fake = createFakeProvider('groq', steps);
  const mistral = createFakeProvider('mistral', steps);
  const file = memFile();
  const { sink, logger } = testLogger();
  let t = Date.parse('2026-11-01T02:00:00+08:00');
  const engine = createAiEngine({
    keyVault: vault,
    fetchFn: jest.fn(async () => {
      throw new Error('real network must not be used in this test');
    }),
    logger,
    ids: seededIds(3),
    usageFile: file,
    gate: { isAdultConfirmed: async () => true, hasConsent: async () => true },
    providers: { groq: fake, mistral },
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    random: () => 0,
    ...over,
  });
  return { engine, fake, mistral, file, sink, vault, advance: (ms: number) => (t += ms) };
}

const run = (engine: Awaited<ReturnType<typeof setup>>['engine'], action: Parameters<typeof engine.run>[0]['action'], extra: Partial<Parameters<typeof engine.run>[0]> = {}, onProgress?: (p: RunProgress) => void) =>
  engine.run({ action, provider: 'groq', doc: sampleDoc(), scope: { kind: 'note' }, aiAllowed: true, ...extra }, { onProgress });

describe('success paths for every action kind', () => {
  it('beautify: proposal -> apply -> undo, ids preserved', async () => {
    const { engine, fake } = await setup([
      { json: { units: [{ ref: 'u2', op: 'replace', blocks: [{ kind: 'paragraph', term: null, text: 'The **mitochondria** makes energy.' }] }] }, usage: { inputTokens: 900, outputTokens: 120 } },
    ]);
    const prop = await run(engine, 'beautify');
    expect(prop.changes).toHaveLength(1);
    expect(prop.changes[0]).toMatchObject({ kind: 'replace', targetId: bid(2) });
    expect(prop.models).toEqual(['openai/gpt-oss-120b']);
    expect(prop.promptVersion).toBe('beautify@1.base@1');
    expect(prop.usage).toEqual({ requests: 1, inputTokens: 900, outputTokens: 120, estimated: false });
    expect(prop.snapshotReason).toBe('Before Beautify');
    // What was sent: aliases only, real ids never.
    const sent = fake.calls[0]?.req;
    expect(sent?.user).toContain('"ref":"u2"');
    expect(sent?.user).not.toContain(bid(2));
    expect(sent?.jsonSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(JSON.stringify(sent?.jsonSchema)).not.toMatch(/maxLength|maxItems|minItems|\$schema/);

    const applied = applyProposal(sampleDoc(), prop, ['c1'], seededIds(9));
    if (!applied.ok) throw applied.error;
    expect(listBlockIds(applied.value.doc)).toEqual(listBlockIds(sampleDoc()));
    const undone = undoApply(applied.value.doc, applied.value.undo);
    expect(undone.ok && listBlockIds(undone.value)).toEqual(listBlockIds(sampleDoc()));
  });

  it('summarize, keyTerms and explain insert after the scope', async () => {
    const { engine, fake } = await setup([{ json: { title: 'Cells', points: ['Mitochondria make energy.', 'The nucleus holds DNA.'] } }]);
    const s = await run(engine, 'summarize');
    expect(s.changes[0]).toMatchObject({ kind: 'insert', afterId: bid(17), aiAdded: true });

    fake.setScript([{ json: { terms: [{ term: 'Osmosis', definition: 'Water moving across a membrane.', sourceRef: 'u6' }] } }]);
    const k = await run(engine, 'keyTerms');
    expect(k.changes[0]?.after[0]).toMatchObject({ type: 'definition', attrs: { term: 'Osmosis' } });

    fake.setScript([{ json: { paragraphs: ['Osmosis is how water moves.'] } }]);
    const e = await run(engine, 'explain', { scope: { kind: 'blocks', blockIds: [bid(11)] } });
    expect(e.changes[0]).toMatchObject({ kind: 'insert', afterId: bid(11) });
    await expect(run(engine, 'explain')).rejects.toMatchObject({ kind: 'invalid_input', reason: 'selection_required' });
  });

  it('flashcards and quiz return drafts and change nothing', async () => {
    const { engine, fake } = await setup([{ json: { cards: [{ type: 'cloze', front: 'The {{ribosome}} makes protein.', back: '', sourceRef: 'u5' }] } }]);
    const c = await run(engine, 'flashcards');
    expect(c.changes).toEqual([]);
    expect(c.cards).toEqual([{ type: 'cloze', front: 'The {{ribosome}} makes protein.', back: '', source: 'ai', sourceBlockId: bid(9) }]);

    fake.setScript([{ json: { questions: [{ kind: 'short', question: 'What is osmosis?', choices: [], answerIndex: null, answer: 'Water movement.', sourceRef: 'u6' }] } }]);
    const q = await run(engine, 'quiz');
    expect(q.quiz).toHaveLength(1);
  });

  it('works the same on the second provider (Mistral)', async () => {
    const { engine, mistral } = await setup([{ json: { units: [] } }]);
    const prop = await run(engine, 'clarify', { provider: 'mistral' });
    expect(prop.provider).toBe('mistral');
    expect(prop.warnings).toEqual(['nothing_found']);
    expect(mistral.calls[0]?.req.model).toBe('mistral-small-latest');
  });
});

describe('invalid output (Q6: reject, re-ask once)', () => {
  it('re-asks once and succeeds', async () => {
    const progress: RunProgress[] = [];
    const { engine, fake, file } = await setup([
      { content: 'Sure! Here is your note: ...' },
      { json: { units: [{ ref: 'u2', op: 'replace', blocks: [{ kind: 'paragraph', term: null, text: 'Fixed.' }] }] } },
    ]);
    const prop = await run(engine, 'clarify', {}, (pr) => progress.push(pr));
    expect(prop.changes).toHaveLength(1);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]?.req.user).toContain('previous answer was rejected');
    expect(progress.some((x) => x.phase === 'reasking')).toBe(true);
    expect(file.content).toContain('"invalid_output":1');
  });

  it('gives up after the second invalid answer and changes nothing', async () => {
    const { engine, fake } = await setup([{ json: { units: [{ ref: 'u42', op: 'delete', blocks: [] }] } }]);
    const err = await run(engine, 'beautify').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ kind: 'invalid_output', reason: 'unknown_ref', code: 'validation_failed' });
    expect(fake.calls).toHaveLength(2);
  });

  it('rejects schema violations, fenced JSON is tolerated', async () => {
    const { engine, fake } = await setup([{ json: { units: [{ ref: 'u2', op: 'rewrite', blocks: [] }] } }]);
    await expect(run(engine, 'beautify')).rejects.toMatchObject({ kind: 'invalid_output', reason: 'schema' });
    fake.setScript([{ content: '```json\n{"units":[]}\n```' }]);
    await expect(run(engine, 'beautify')).resolves.toMatchObject({ warnings: ['nothing_found'] });
  });

  it('reports truncation when the answer was cut off', async () => {
    const { engine } = await setup([{ content: '{"units":[{"ref":"u2"', finishReason: 'length' }]);
    await expect(run(engine, 'beautify')).rejects.toMatchObject({ kind: 'invalid_output', reason: 'truncated' });
  });
});

describe('rate limits, bad key, offline, timeout, cancel', () => {
  const rl = (ms: number | null, scope: 'minute' | 'day') => ({ error: new AiError('rate_limited', { providerLabel: 'Groq', retryAfterMs: ms, scope }) });
  const ok = { json: { units: [] } };

  it('auto-retries a short 429 (<= 10 s) on the same model', async () => {
    const progress: RunProgress[] = [];
    const { engine, fake } = await setup([rl(4_000, 'minute'), ok]);
    await run(engine, 'beautify', {}, (x) => progress.push(x));
    expect(fake.calls.map((c) => c.req.model)).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-120b']);
    expect(progress).toContainEqual({ phase: 'waiting', reason: 'rate_limited', waitMs: 4_250 });
  });

  it('falls back to gpt-oss-20b when gpt-oss-120b is out of quota (Q3)', async () => {
    const { engine, fake } = await setup([rl(25 * 60_000, 'day'), ok]);
    const prop = await run(engine, 'beautify');
    expect(fake.calls.map((c) => c.req.model)).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
    expect(prop.models).toEqual(['openai/gpt-oss-20b']);
  });

  it('when every model is limited: a friendly day-limit message naming the provider', async () => {
    const { engine, file } = await setup([rl(20 * 60_000, 'day')]);
    const err = (await run(engine, 'beautify').catch((e: unknown) => e)) as AiError;
    expect(err.kind).toBe('rate_limited');
    expect(err.message).toBe('Your free Groq limit is used up for now. Try again in about 20 minutes, or switch provider.');
    expect(file.content).toContain('"rateLimited":2');
  });

  it('bad key: "This key was rejected by Groq."', async () => {
    const { engine } = await setup([{ error: new AiError('invalid_key', { providerLabel: 'Groq', status: 401 }) }]);
    await expect(run(engine, 'beautify')).rejects.toMatchObject({ kind: 'invalid_key', message: 'This key was rejected by Groq.' });
  });

  it('offline: detected before sending, and from a failed request', async () => {
    const pre = await setup([{ json: { units: [] } }], { isOnline: async () => false });
    await expect(run(pre.engine, 'beautify')).rejects.toMatchObject({ kind: 'offline', message: 'Needs internet. You can still use Beautify Lite.' });
    expect(pre.fake.calls).toHaveLength(0);
    const mid = await setup([{ error: new AiError('offline', { providerLabel: 'Groq' }) }]);
    await expect(run(mid.engine, 'beautify')).rejects.toMatchObject({ kind: 'offline' });
  });

  it('timeouts are retried once; 5xx twice', async () => {
    const t = await setup([{ error: new AiError('timeout', { providerLabel: 'Groq' }) }, ok]);
    await run(t.engine, 'beautify');
    expect(t.fake.calls).toHaveLength(2);
    const s = await setup([{ error: new AiError('provider_error', { providerLabel: 'Groq', status: 502 }) }]);
    await expect(run(s.engine, 'beautify')).rejects.toMatchObject({ kind: 'provider_error' });
    expect(s.fake.calls).toHaveLength(3);
  });

  it('cancel stops the run and nothing is returned', async () => {
    const { engine } = await setup([ok]);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(engine.run({ action: 'beautify', provider: 'groq', doc: sampleDoc(), scope: { kind: 'note' }, aiAllowed: true }, { signal: ctrl.signal })).rejects.toMatchObject({ kind: 'cancelled' });
  });
});

describe('gates and input checks (before anything is sent)', () => {
  it('subject switch, 18+, consent and missing key each stop the run', async () => {
    const blocked = await setup([{ json: { units: [] } }]);
    await expect(run(blocked.engine, 'beautify', { aiAllowed: false })).rejects.toMatchObject({ kind: 'blocked' });

    const minor = await setup([{ json: { units: [] } }], { gate: { isAdultConfirmed: async () => false, hasConsent: async () => true } });
    await expect(run(minor.engine, 'beautify')).rejects.toMatchObject({ kind: 'age_required' });

    const noConsent = await setup([{ json: { units: [] } }], { gate: { isAdultConfirmed: async () => true, hasConsent: async (p) => p !== 'mistral' } });
    await expect(run(noConsent.engine, 'beautify', { provider: 'mistral' })).rejects.toMatchObject({ kind: 'consent_required', message: 'Allow sending this note to Mistral first.' });

    const noKey = await setup([{ json: { units: [] } }]);
    await noKey.vault.remove('groq');
    await expect(run(noKey.engine, 'beautify')).rejects.toMatchObject({ kind: 'missing_key' });

    for (const s of [blocked, minor, noConsent, noKey]) expect(s.fake.calls.length + s.mistral.calls.length).toBe(0);
  });

  it('rejects bad documents, ids, scopes and actions', async () => {
    const { engine } = await setup([{ json: { units: [] } }]);
    await expect(run(engine, 'beautify', { doc: { type: 'doc', content: [{ type: 'script' }] } as unknown as NoteDoc })).rejects.toMatchObject({ reason: 'doc_invalid' });
    await expect(run(engine, 'beautify', { doc: doc({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }) })).rejects.toMatchObject({ reason: 'doc_ids_missing' });
    await expect(run(engine, 'beautify', { scope: { kind: 'blocks', blockIds: [] } })).rejects.toMatchObject({ reason: 'scope_invalid' });
    await expect(run(engine, 'hack' as never)).rejects.toMatchObject({ reason: 'unknown_action' });
    await expect(run(engine, 'beautify', { doc: doc(p(bid(1))) })).rejects.toMatchObject({ kind: 'empty_scope' });
  });

  it('too long for the free budget -> too_large', async () => {
    const big = doc(...Array.from({ length: 80 }, (_, i) => p(bid(i + 1), 'word '.repeat(400))));
    const { engine } = await setup([{ json: { units: [] } }]);
    await expect(run(engine, 'beautify', { doc: big })).rejects.toMatchObject({ kind: 'too_large', reason: 'too_many_chunks' });
  });
});

describe('chunking, pacing and usage', () => {
  it('splits a long note, sends each part, and paces under Groq TPM', async () => {
    const long = doc(...Array.from({ length: 24 }, (_, i) => p(bid(i + 1), `Point ${i}: ` + 'lorem ipsum '.repeat(40))));
    const progress: RunProgress[] = [];
    const { engine, fake, file } = await setup([{ json: { units: [] }, usage: { inputTokens: 3_000, outputTokens: 400 } }]);
    await run(engine, 'beautify', { doc: long }, (x) => progress.push(x));
    const parts = fake.calls.length;
    expect(parts).toBeGreaterThan(1);
    expect(fake.calls[0]?.req.user).toContain(`part 1 of ${parts}`);
    expect(progress.some((x) => x.phase === 'waiting' && x.reason === 'pacing')).toBe(true);
    const today = await engine.usage.today('groq');
    expect(today).toMatchObject({ requests: parts, ok: parts, inputTokens: 3_000 * parts, outputTokens: 400 * parts, day: '2026-11-01' });
    expect(today.limits['openai/gpt-oss-120b']).toEqual({ rpm: 30, rpd: 1_000, tpm: 8_000, tpd: 200_000 });
    expect(file.content).not.toContain('lorem');
  });

  it('testKey goes through the adapter', async () => {
    const { engine, fake } = await setup([]);
    await expect(engine.testKey('groq')).resolves.toEqual({ ok: true });
    (fake as FakeProvider).keyTest = { ok: false, reason: 'invalid_key' };
    await expect(engine.testKey('groq')).resolves.toEqual({ ok: false, reason: 'invalid_key' });
    expect(engine.providers.map((x) => x.id)).toEqual(['groq', 'mistral']);
    expect(engine.providers.every((x) => x.minAge === 18)).toBe(true);
  });
});
