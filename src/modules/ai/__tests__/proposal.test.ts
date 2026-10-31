/**
 * Proposals: AI output rules (§4), apply with invariants (§6), block-level
 * rebase (§6.1, Q7), exact undo (§7), and card / quiz drafts in P2a fields.
 */
import { listBlockIds, validateNoteDoc, type NoteDoc } from '@/core';

import { ACTION_DEFS } from '../actions/registry';
import type { EditPlan } from '../actions/schemas';
import { canonicalJson, findNode } from '../document/nodes';
import { extractUnits } from '../document/units';
import { applyProposal, findStaleChanges, undoApply } from '../proposal/apply';
import { buildCards, buildEditChanges, buildKeyTermChanges, buildQuiz, buildSummaryChange, OutputRejected, type NewChange } from '../proposal/build';
import type { Proposal } from '../proposal/types';
import { bid, doc, li, p, sampleDoc, seededIds, ul } from './fixtures';

const units = () => extractUnits(sampleDoc(), { kind: 'note' });
const blk = (text: string, kind: 'paragraph' | 'heading2' | 'bullet' | 'definition' | 'callout' = 'paragraph', term: string | null = null) => ({ kind, term, text });

function proposalOf(changes: NewChange[], base: NoteDoc = sampleDoc()): Proposal {
  return {
    id: 'aip_test',
    action: 'beautify',
    provider: 'groq',
    models: ['openai/gpt-oss-120b'],
    promptVersion: 'beautify@1.base@1',
    createdAt: 0,
    baseDocJson: canonicalJson(base),
    sentBlockIds: [],
    changes: changes.map((c, i) => ({ ...c, changeId: `c${i + 1}` })),
    cards: [],
    quiz: [],
    warnings: [],
    snapshotReason: 'Before Beautify',
    usage: { requests: 1, inputTokens: 0, outputTokens: 0, estimated: false },
  };
}

const plan = (entries: EditPlan['units']): EditPlan => ({ units: entries });

describe('§4 edit output rules', () => {
  const beautify = ACTION_DEFS.beautify;
  const clarify = ACTION_DEFS.clarify;

  it('rejects unknown, duplicate and read-only refs', () => {
    const us = units();
    expect(() => buildEditChanges(beautify, us, plan([{ ref: 'u99', op: 'replace', blocks: [blk('x')] }]))).toThrow(OutputRejected);
    expect(() => buildEditChanges(beautify, us, plan([{ ref: 'b_t00000000002', op: 'delete', blocks: [] }]))).toThrow('unknown_ref');
    expect(() =>
      buildEditChanges(beautify, us, plan([
        { ref: 'u2', op: 'replace', blocks: [blk('a')] },
        { ref: 'u2', op: 'delete', blocks: [] },
      ])),
    ).toThrow('duplicate_ref');
    const ro = [{ ...(us[1] as (typeof us)[number]), readOnly: true }];
    expect(() => buildEditChanges(beautify, ro, plan([{ ref: 'u2', op: 'replace', blocks: [blk('x')] }]))).toThrow('readonly_changed');
  });

  it('enforces per-action permissions', () => {
    const us = units();
    expect(() => buildEditChanges(ACTION_DEFS.translate, us, plan([{ ref: 'u2', op: 'delete', blocks: [] }]))).toThrow('delete_not_allowed');
    expect(() => buildEditChanges(beautify, us, plan([{ ref: 'end', op: 'replace', blocks: [blk('x')] }]))).toThrow('insert_not_allowed');
    expect(() => buildEditChanges(beautify, us, plan([{ ref: 'u2', op: 'replace', blocks: [] }]))).toThrow('empty_replace');
  });

  it('omitted blocks are kept, and no-op rewrites produce no change', () => {
    const us = units();
    const same = buildEditChanges(beautify, us, plan([{ ref: 'u1', op: 'replace', blocks: [blk('Cell biology', 'heading2')] }]));
    expect(same.changes).toHaveLength(1); // level changed 1 -> 2 is a real change
    const noop = buildEditChanges(clarify, us, plan([{ ref: 'u5', op: 'replace', blocks: [blk('ribosome makes protein')] }]));
    expect(noop.changes).toEqual([]);
    expect(buildEditChanges(beautify, us, plan([])).changes).toEqual([]);
  });

  it('keeps kind for actions that may not change it', () => {
    const r = buildEditChanges(clarify, units(), plan([{ ref: 'u2', op: 'replace', blocks: [blk('Mitochondria make energy.', 'heading2')] }]));
    expect(r.changes[0]?.after[0]?.type).toBe('paragraph');
  });

  it('refuses to delete a list item that has sub-items (warning, kept)', () => {
    const r = buildEditChanges(beautify, units(), plan([{ ref: 'u3', op: 'delete', blocks: [] }]));
    expect(r.changes).toEqual([]);
    expect(r.warnings).toEqual(['kept_item_with_subitems']);
  });

  it("Expand's pattern (original first, then new) becomes an insert, flagged AI-added", () => {
    const r = buildEditChanges(ACTION_DEFS.expand, units(), plan([{ ref: 'u5', op: 'replace', blocks: [blk('ribosome makes protein'), blk('Ribosomes read mRNA.')] }]));
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ kind: 'insert', afterId: bid(9), aiAdded: true });
    expect(r.changes[0]?.after[0]?.type).toBe('listItem');
  });
});

describe('§6 apply, rebase and undo', () => {
  const ids = () => seededIds(7);

  function beautifyProposal() {
    const us = units();
    const { changes } = buildEditChanges(ACTION_DEFS.beautify, us, plan([
      { ref: 'u2', op: 'replace', blocks: [blk('The **mitochondria** makes energy.'), blk('It is the powerhouse of the cell.', 'callout')] },
      { ref: 'u5', op: 'replace', blocks: [blk('Ribosomes make ==protein==')] },
      { ref: 'u7', op: 'delete', blocks: [] },
    ]));
    return proposalOf(changes);
  }

  it('applies accepted changes and keeps every untouched block id', () => {
    const before = sampleDoc();
    const prop = beautifyProposal();
    const r = applyProposal(before, prop, ['c1', 'c2', 'c3'], ids());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = r.value.doc;
    expect(validateNoteDoc(after).ok).toBe(true);
    const afterIds = new Set(listBlockIds(after));
    for (const id of listBlockIds(before)) {
      if (id === bid(13) || id === bid(14)) expect(afterIds.has(id)).toBe(false); // deleted callout
      else expect(afterIds.has(id)).toBe(true);
    }
    expect(r.value.removedBlockIds.sort()).toEqual([bid(13), bid(14)].sort());
    expect(r.value.changedBlockIds.sort()).toEqual([bid(10), bid(2), bid(9)].sort());
    expect(r.value.newBlockIds).toHaveLength(2); // the new callout + its paragraph
    expect(r.value.appliedChangeIds).toEqual(['c1', 'c2', 'c3']);
    // The new callout sits right after the rewritten paragraph.
    expect(after.content.map((n) => n.type).slice(0, 4)).toEqual(['heading', 'paragraph', 'callout', 'bulletList']);
  });

  it('applies only the accepted subset (accept per block)', () => {
    const r = applyProposal(sampleDoc(), beautifyProposal(), ['c2'], ids());
    expect(r.ok && r.value.appliedChangeIds).toEqual(['c2']);
    if (!r.ok) return;
    expect(findNode(r.value.doc, bid(13))).not.toBeNull();
    expect(JSON.stringify(findNode(r.value.doc, bid(10)))).toContain('protein');
  });

  it('turns off stale changes when the note changed meanwhile (Q7 block-level rebase)', () => {
    const prop = beautifyProposal();
    const edited = sampleDoc();
    (edited.content[1] as { content: unknown[] }).content = [{ type: 'text', text: 'the student edited this line' }];
    expect(findStaleChanges(edited, prop)).toEqual(['c1']);
    const r = applyProposal(edited, prop, ['c1', 'c2', 'c3'], ids());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.staleChangeIds).toEqual(['c1']);
    expect(r.value.appliedChangeIds).toEqual(['c2', 'c3']);
    expect(JSON.stringify(findNode(r.value.doc, bid(2)))).toContain('the student edited this line');
  });

  it('undo restores the note exactly, with the same block ids', () => {
    const before = sampleDoc();
    const r = applyProposal(before, beautifyProposal(), ['c1', 'c2', 'c3'], ids());
    if (!r.ok) throw r.error;
    const u = undoApply(r.value.doc, r.value.undo);
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(canonicalJson(u.value)).toBe(canonicalJson(validateNoteDoc(before).ok ? before : null));
    expect(listBlockIds(u.value)).toEqual(listBlockIds(before));
  });

  it('refuses undo after a later edit (stale), so nothing is overwritten', () => {
    const r = applyProposal(sampleDoc(), beautifyProposal(), ['c1'], ids());
    if (!r.ok) throw r.error;
    const later: NoteDoc = { ...r.value.doc, content: [...r.value.doc.content, p(bid(99), 'typed after AI')] };
    const u = undoApply(later, r.value.undo);
    expect(u.ok).toBe(false);
    expect(!u.ok && u.error).toMatchObject({ kind: 'stale' });
  });

  it('drops a list whose items were all deleted and accounts for its id', () => {
    const d = doc(p(bid(1), 'intro'), ul(bid(2), [li(bid(3), p(bid(4), 'only item'))]));
    const us = extractUnits(d, { kind: 'note' });
    const { changes } = buildEditChanges(ACTION_DEFS.beautify, us, plan([{ ref: 'u2', op: 'delete', blocks: [] }]));
    const r = applyProposal(d, proposalOf(changes, d), ['c1'], ids());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.doc.content).toHaveLength(1);
    expect(r.value.removedBlockIds.sort()).toEqual([bid(2), bid(3), bid(4)].sort());
  });

  it('applies a nested change under a rewritten parent list item', () => {
    const us = units();
    const { changes } = buildEditChanges(ACTION_DEFS.beautify, us, plan([
      { ref: 'u3', op: 'replace', blocks: [blk('The nucleus holds DNA')] },
      { ref: 'u4', op: 'replace', blocks: [blk('Chromosomes are inside it')] },
    ]));
    const r = applyProposal(sampleDoc(), proposalOf(changes), ['c1', 'c2'], ids());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(findNode(r.value.doc, bid(7)))).toContain('Chromosomes are inside it');
    expect(JSON.stringify(findNode(r.value.doc, bid(4)))).toContain('The nucleus holds DNA');
  });

  it('never returns a broken document: id collisions and bad input are errors', () => {
    const collide = { newId: () => bid(1) }; // always returns an existing id
    const r = applyProposal(sampleDoc(), beautifyProposal(), ['c1'], collide);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatchObject({ kind: 'internal', reason: 'id_collision' });
    const noIds = doc({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] });
    expect(applyProposal(noIds, beautifyProposal(), [], ids()).ok).toBe(false);
    expect(applyProposal(sampleDoc(), beautifyProposal(), ['c9'], ids()).ok).toBe(false);
  });
});

describe('generated content and drafts', () => {
  it('summary becomes one callout with a bullet list; empty output adds nothing', () => {
    const c = buildSummaryChange({ title: null, points: ['Mitochondria make energy.', '  '] }, bid(17));
    expect(c?.after[0]?.type).toBe('callout');
    expect(JSON.stringify(c?.after)).toContain('Summary');
    expect(buildSummaryChange({ title: 'x', points: [] }, bid(17))).toBeNull();
  });

  it('key terms need known refs and are de-duplicated across chunks', () => {
    const us = units();
    const seen = new Set<string>();
    const out = { terms: [{ term: 'Osmosis', definition: 'Water moving across a membrane.', sourceRef: 'u6' }, { term: 'osmosis', definition: 'dup', sourceRef: 'u6' }] };
    expect(buildKeyTermChanges(out, us, bid(17), seen)).toHaveLength(1);
    expect(() => buildKeyTermChanges({ terms: [{ term: 'X', definition: 'y', sourceRef: 'u42' }] }, us, bid(17), new Set())).toThrow('unknown_ref');
  });

  it('cards match P2a fields and rules', () => {
    const us = units();
    const cards = buildCards(
      {
        cards: [
          { type: 'basic', front: 'What makes energy?', back: 'Mitochondria', sourceRef: 'u2' },
          { type: 'reversed', front: 'Osmosis', back: 'Water moving across a membrane', sourceRef: 'u6' },
          { type: 'cloze', front: 'The {{nucleus}} holds DNA.', back: '', sourceRef: 'u3' },
        ],
      },
      us,
      new Set(),
    );
    expect(cards).toEqual([
      { type: 'basic', front: 'What makes energy?', back: 'Mitochondria', source: 'ai', sourceBlockId: bid(2) },
      { type: 'reversed', front: 'Osmosis', back: 'Water moving across a membrane', source: 'ai', sourceBlockId: bid(11) },
      { type: 'cloze', front: 'The {{nucleus}} holds DNA.', back: '', source: 'ai', sourceBlockId: bid(4) },
    ]);
    const bad = (c: object) => () => buildCards({ cards: [{ type: 'basic', front: 'q', back: 'a', sourceRef: 'u2', ...c }] } as never, us, new Set());
    expect(bad({ back: '' })).toThrow('card_missing_back');
    expect(bad({ type: 'cloze', front: 'no holes here' })).toThrow('cloze_format');
    expect(bad({ type: 'cloze', front: '{{a}} and {{b}}' })).toThrow('cloze_format');
    expect(bad({ front: 'x'.repeat(2_001) })).toThrow('card_length');
    expect(bad({ sourceRef: 'u77' })).toThrow('unknown_ref');
  });

  it('quiz: mcq answers come from the chosen option; short answers have no choices', () => {
    const us = units();
    const qs = buildQuiz(
      {
        questions: [
          { kind: 'mcq', question: 'What makes protein?', choices: ['Ribosome', 'Nucleus', 'Membrane'], answerIndex: 0, answer: 'something else', sourceRef: 'u5' },
          { kind: 'short', question: 'Define osmosis.', choices: [], answerIndex: null, answer: 'Water moving across a membrane.', sourceRef: 'u6' },
        ],
      },
      us,
      new Set(),
    );
    expect(qs[0]).toMatchObject({ answer: 'Ribosome', sourceBlockId: bid(9) });
    expect(qs[1]).toMatchObject({ kind: 'short', choices: [], answerIndex: null });
    const bad = (q: object) => () =>
      buildQuiz({ questions: [{ kind: 'mcq', question: 'q', choices: ['a', 'b', 'c'], answerIndex: 1, answer: 'b', sourceRef: 'u5', ...q }] } as never, us, new Set());
    expect(bad({ choices: ['a', 'b'] })).toThrow('mcq_choices');
    expect(bad({ choices: ['a', 'A', 'b'] })).toThrow('mcq_choices');
    expect(bad({ answerIndex: 3 })).toThrow('mcq_answer');
    expect(bad({ kind: 'short' })).toThrow('short_format');
  });
});

describe('findStaleChanges input handling', () => {
  it('validates the note itself (extra attrs stripped, invalid note -> all stale)', () => {
    const us = extractUnits(sampleDoc(), { kind: 'note' });
    const { changes } = buildEditChanges(ACTION_DEFS.beautify, us, { units: [{ ref: 'u2', op: 'replace', blocks: [{ kind: 'paragraph', term: null, text: 'x' }] }] });
    const prop = { changes: changes.map((c, i) => ({ ...c, changeId: `c${i + 1}` })) };
    const withExtra = sampleDoc();
    (withExtra.content[1] as { attrs: Record<string, unknown> }).attrs.unknownAttr = 'stripped by the schema';
    expect(findStaleChanges(withExtra, prop)).toEqual([]);
    expect(findStaleChanges({ type: 'doc', content: [{ type: 'script' }] } as unknown as NoteDoc, prop)).toEqual(['c1']);
  });
});
