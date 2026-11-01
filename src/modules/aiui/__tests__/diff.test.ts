/**
 * §2 word diff, §2.4 display text, §4 usage and wait wording, and the one
 * next step per error (Plan §9.6).
 */
import { AiError, AI_ERROR_KINDS } from '@/modules/ai';

import { blockView, nodesView } from '../diff/blockText';
import { buildDiffRows } from '../diff/viewModel';
import { afterSide, beforeSide, MAX_DIFF_WORDS, tokenize, wordDiff } from '../diff/wordDiff';
import { errorView } from '../flow/messages';
import { progressText, usageText, waitText } from '../format';
import { bid, noteDoc, para } from './helpers';

const join = (s: { text: string }[]) => s.map((x) => x.text).join('');

describe('§2 word diff', () => {
  it('tokens rebuild the text exactly', () => {
    for (const s of ['', '  lead', 'a b  c ', 'one\ntwo', 'x']) expect(tokenize(s).join('')).toBe(s);
  });

  it('marks only the changed words; the after side rebuilds exactly', () => {
    const before = 'the mitochondria makes energy';
    const after = 'The mitochondria makes energy for cells';
    const d = wordDiff(before, after);
    expect(join(afterSide(d))).toBe(after);
    // Equal words carry the AFTER spacing (§2.2), so compare the before side word by word.
    expect(join(beforeSide(d)).trim().split(/\s+/)).toEqual(before.split(' '));
    expect(d.filter((x) => x.kind === 'removed').map((x) => x.text.trim())).toEqual(['the']);
    expect(d.filter((x) => x.kind === 'added').map((x) => x.text.trim())).toEqual(['The', 'for cells']);
  });

  it('identical text is one equal segment', () => {
    expect(wordDiff('same words', 'same words')).toEqual([{ kind: 'equal', text: 'same words' }]);
  });

  it('LCS is minimal: edits = n + m - 2·LCS', () => {
    const a = 'a b c d e f';
    const b = 'a x c d y f';
    const d = wordDiff(a, b);
    const edits = d.filter((x) => x.kind !== 'equal').reduce((n, x) => n + tokenize(x.text).length, 0);
    expect(edits).toBe(6 + 6 - 2 * 4);
  });

  it(`falls back to whole block above ${MAX_DIFF_WORDS} words (§2.3)`, () => {
    const long = Array.from({ length: MAX_DIFF_WORDS + 1 }, (_, i) => `w${i}`).join(' ');
    const d = wordDiff(long, `${long} more`);
    expect(d).toEqual([
      { kind: 'removed', text: long },
      { kind: 'added', text: `${long} more` },
    ]);
  });
});

describe('§2.4 block display text', () => {
  it('headings, definitions and lists', () => {
    expect(blockView({ type: 'heading', attrs: { level: 2, blockId: bid(1) }, content: [{ type: 'text', text: 'Cells' }] })).toEqual({ label: 'Heading 2', text: 'Cells' });
    expect(blockView({ type: 'definition', attrs: { term: 'Osmosis', blockId: bid(2) }, content: [para(bid(3), 'water moves')] }).text).toBe('Osmosis: water moves');
    const list = blockView({ type: 'bulletList', attrs: { blockId: bid(4) }, content: [{ type: 'listItem', attrs: { blockId: bid(5) }, content: [para(bid(6), 'one')] }, { type: 'listItem', attrs: { blockId: bid(7) }, content: [para(bid(8), 'two')] }] });
    expect(list.text).toBe('• one\n• two');
    expect(nodesView([]).label).toBe('Removed');
  });

  it('a stale change is detected against the current note', () => {
    const rows = buildDiffRows(noteDoc(), {
      changes: [
        { changeId: 'c1', kind: 'replace', targetId: bid(2), afterId: null, before: para(bid(2), 'the mitochondria makes energy'), after: [para(bid(2), 'New')], aiAdded: false, removesIds: [] },
        { changeId: 'c2', kind: 'delete', targetId: bid(3), afterId: null, before: para(bid(3), 'changed meanwhile'), after: [], aiAdded: false, removesIds: [bid(3)] },
        { changeId: 'c3', kind: 'insert', targetId: null, afterId: bid(3), before: null, after: [para('', 'Summary')], aiAdded: true, removesIds: [] },
      ],
    } as never);
    expect(rows.map((r) => [r.changeId, r.stale, r.label])).toEqual([
      ['c1', false, 'Text'],
      ['c2', true, 'Removed'],
      ['c3', false, 'Text'],
    ]);
    expect(rows[2]!.segments).toEqual([{ kind: 'added', text: 'Summary' }]);
  });
});

describe('§4 usage and progress wording', () => {
  it('N of L today, or N today when unpublished', () => {
    expect(usageText({ provider: 'groq', requests: 1234, dailyLimit: 1000, remaining: null, checkedOn: '2026-11-01' })).toBe('Groq · 1,234 of 1,000 requests today.');
    expect(usageText({ provider: 'mistral', requests: 3, dailyLimit: null, remaining: 40, checkedOn: '2026-11-01' })).toBe(
      'Mistral · 3 requests today (Mistral doesn’t publish its free limits). 40 left, says the provider.',
    );
  });
  it('waits round up to seconds, then minutes', () => {
    expect(waitText(1)).toBe('1 s');
    expect(waitText(4_100)).toBe('5 s');
    expect(waitText(20 * 60_000)).toBe('about 20 minutes');
  });
  it('progress names the provider', () => {
    expect(progressText({ phase: 'sending', part: 1, parts: 3, model: 'm' }, 'groq')).toBe('Waiting for Groq… (part 2 of 3)');
    expect(progressText({ phase: 'fallback', model: 'm' }, 'groq')).toBe('Trying Groq’s backup model…');
    expect(progressText(null, 'mistral')).toBe('Getting ready for Mistral…');
  });
});

describe('Plan §9.6: one next step per error', () => {
  it.each(AI_ERROR_KINDS.map((k) => [k]))('%s has a message and exactly one next step', (kind) => {
    const v = errorView(new AiError(kind, { providerLabel: 'Groq' }), 'mistral');
    expect(v.message.length).toBeGreaterThan(5);
    expect(['retry', 'replace_key', 'switch_provider', 'beautify_lite', 'select_part', 'ok']).toContain(v.next);
    expect(v.message).not.toMatch(/you (failed|did something wrong)/i); // never blaming
  });
  it('provider-specific errors name the provider', () => {
    expect(errorView(new AiError('invalid_key', { providerLabel: 'Groq' }), null).message).toBe('This key was rejected by Groq.');
    expect(errorView(new AiError('invalid_output', { providerLabel: 'Mistral' }), null).message).toContain('Mistral');
  });
  it('switch_provider becomes OK when no other provider has a key', () => {
    expect(errorView(new AiError('rate_limited', { providerLabel: 'Groq' }), null).next).toBe('ok');
    expect(errorView(new AiError('rate_limited', { providerLabel: 'Groq' }), 'mistral')).toMatchObject({ next: 'switch_provider', switchTo: 'mistral' });
  });
  it('a non-AI error gets the generic safe message', () => {
    expect(errorView(new Error('secret detail'), null)).toMatchObject({ kind: 'unknown', next: 'ok', message: 'Something went wrong. Please try again.' });
  });
});
