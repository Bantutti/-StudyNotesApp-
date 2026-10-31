/**
 * AI output -> proposal parts (changes, card drafts, quiz drafts).
 *
 * Everything the AI returns is untrusted. These functions run AFTER the zod
 * schema check and enforce the rules zod cannot express: refs must be known
 * aliases of this chunk, used once, read-only units unchanged, deletes only
 * where the action allows them, card rules from P2a, and so on. Any
 * violation throws OutputRejected; the engine re-asks once, then gives up
 * with 'invalid_output' and changes nothing (Rey Nov 1, Q6 = A).
 */
import type { DocNode } from '@/core';

import type { ActionDef } from '../actions/registry';
import {
  CARD_BACK_MAX,
  CARD_FRONT_MAX,
  type CardsOut,
  type EditPlan,
  type ExplainOut,
  type KeyTermsOut,
  type QuizOut,
  type SummaryOut,
} from '../actions/schemas';
import { parseInline } from '../document/marks';
import { materializeListItems, materializeTop, sanitizeAiText, type AiBlock } from '../document/materialize';
import { canonicalJson, idsIn, loose, typed, type LooseNode } from '../document/nodes';
import type { Unit } from '../document/units';
import type { BlockChange, CardDraft, QuizDraft } from './types';

/** Thrown for an answer that passed zod but broke a rule. `reason` is a code, never content. */
export class OutputRejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'OutputRejected';
  }
}

/** P2a: sourceBlockId must match this (firebase/src/schemas/limits.ts BLOCK_ID_PATTERN). */
const P2A_BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type NewChange = Omit<BlockChange, 'changeId'>;

/** §4.3 ids that disappear: ids(before) − ids(after). */
function removedIds(before: DocNode | null, after: readonly DocNode[]): string[] {
  if (!before) return [];
  const kept = new Set(idsIn(after));
  return idsIn([before]).filter((id) => !kept.has(id));
}

const hasNestedLists = (u: Unit) => (loose(u.node).content ?? []).some((c) => c.type === 'bulletList' || c.type === 'orderedList');

function materialize(u: Unit | null, blocks: readonly AiBlock[], context: 'top' | 'list'): DocNode[] {
  const opts = { links: u?.links ?? [], highlightKey: u?.highlightKey ?? null };
  return context === 'list' ? materializeListItems(blocks, u, opts) : materializeTop(blocks, u, opts);
}

// ---------------------------------------------------------------------------
// Edit actions
// ---------------------------------------------------------------------------

/**
 * Turns one chunk's EditPlan into changes, in document order.
 * See ALGORITHMS §4 for the alias and id rules.
 */
export function buildEditChanges(action: ActionDef, chunk: readonly Unit[], plan: EditPlan): { changes: NewChange[]; warnings: string[] } {
  const byAlias = new Map(chunk.map((u, i) => [u.alias, { u, i }]));
  const seen = new Set<string>();
  const out: { order: number; change: NewChange }[] = [];
  const warnings: string[] = [];

  for (const entry of plan.units) {
    if (seen.has(entry.ref)) throw new OutputRejected('duplicate_ref');
    seen.add(entry.ref);

    // "end": append new blocks after the chunk's last unit (top-level).
    if (entry.ref === 'end') {
      if (entry.op === 'keep' || entry.blocks.length === 0) continue;
      if (entry.op !== 'replace' || !action.allowEnd) throw new OutputRejected('insert_not_allowed');
      const last = chunk[chunk.length - 1] as Unit;
      out.push({
        order: Number.MAX_SAFE_INTEGER,
        change: { kind: 'insert', targetId: null, afterId: last.topId, before: null, after: materialize(null, entry.blocks, 'top'), aiAdded: true, removesIds: [] },
      });
      continue;
    }

    const hit = byAlias.get(entry.ref);
    if (!hit) throw new OutputRejected('unknown_ref');
    const { u, i } = hit;
    if (entry.op === 'keep') continue;
    if (u.readOnly) throw new OutputRejected('readonly_changed');

    if (entry.op === 'delete') {
      if (!action.allowDelete) throw new OutputRejected('delete_not_allowed');
      if (u.context === 'list' && hasNestedLists(u)) {
        // Deleting would silently delete its sub-items too: keep it instead.
        warnings.push('kept_item_with_subitems');
        continue;
      }
      out.push({ order: i, change: { kind: 'delete', targetId: u.blockId, afterId: null, before: u.node, after: [], aiAdded: false, removesIds: idsIn([u.node]) } });
      continue;
    }

    // replace
    if (entry.blocks.length === 0) throw new OutputRejected('empty_replace');
    const blocks: AiBlock[] = entry.blocks.map((b) => ({ ...b }));
    if (!action.allowKindChange && u.context === 'top') {
      // Keep the unit's kind (and term) for the block that takes its place.
      const first = blocks[0] as AiBlock;
      blocks[0] = { ...first, kind: u.kind, term: u.kind === 'definition' ? (first.term ?? u.term) : null };
    }

    const firstOnly = materialize(u, blocks.slice(0, 1), u.context);
    const firstUnchanged = firstOnly.length === 1 && canonicalJson(firstOnly[0]) === canonicalJson(u.node);

    if (firstUnchanged && blocks.length === 1) continue; // no-op rewrite
    if (firstUnchanged) {
      // Original kept, new blocks added after it (Expand's pattern).
      const added = materialize(null, blocks.slice(1), u.context);
      out.push({ order: i, change: { kind: 'insert', targetId: null, afterId: u.blockId, before: null, after: added, aiAdded: true, removesIds: [] } });
      continue;
    }
    const after = materialize(u, blocks, u.context);
    out.push({
      order: i,
      change: { kind: 'replace', targetId: u.blockId, afterId: null, before: u.node, after, aiAdded: action.markAdded && blocks.length > 1, removesIds: removedIds(u.node, after) },
    });
  }

  out.sort((a, b) => a.order - b.order);
  return { changes: out.map((o) => o.change), warnings };
}

// ---------------------------------------------------------------------------
// Generated content (inserted after the scope)
// ---------------------------------------------------------------------------

const bold = (text: string): LooseNode => ({ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] });
const para = (marked: string): LooseNode => {
  const content = parseInline(sanitizeAiText(marked), { allowBreaks: false }) as unknown as LooseNode[];
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
};
const clean = (s: string) => sanitizeAiText(s);

/** Summary -> one callout: bold title, then a bullet list of points. */
export function buildSummaryChange(out: SummaryOut, afterId: string): NewChange | null {
  const points = out.points.map(clean).filter((p) => p.length > 0).slice(0, 12);
  if (points.length === 0) return null;
  const title = clean(out.title ?? '').replace(/\n/g, ' ').slice(0, 120) || 'Summary';
  const list: LooseNode = { type: 'bulletList', content: points.map((p) => ({ type: 'listItem', content: [para(p)] })) };
  const node = typed({ type: 'callout', content: [bold(title), list] });
  return { kind: 'insert', targetId: null, afterId, before: null, after: [node], aiAdded: true, removesIds: [] };
}

/** Key terms -> one definition block per term (each its own change, so each can be accepted). */
export function buildKeyTermChanges(out: KeyTermsOut, chunk: readonly Unit[], afterId: string, already: Set<string>): NewChange[] {
  const aliases = new Set(chunk.map((u) => u.alias));
  const changes: NewChange[] = [];
  for (const t of out.terms) {
    if (!aliases.has(t.sourceRef)) throw new OutputRejected('unknown_ref');
    const term = clean(t.term).replace(/\n/g, ' ').slice(0, 200);
    const definition = clean(t.definition);
    if (!term || !definition) throw new OutputRejected('empty_term');
    const k = term.toLowerCase();
    if (already.has(k)) continue; // same term from an earlier chunk
    already.add(k);
    const node = typed({ type: 'definition', attrs: { term }, content: [para(definition)] });
    changes.push({ kind: 'insert', targetId: null, afterId, before: null, after: [node], aiAdded: true, removesIds: [] });
  }
  return changes;
}

/** Explain -> one callout after the selection. */
export function buildExplainChange(out: ExplainOut, afterId: string): NewChange | null {
  const paragraphs = out.paragraphs.map(clean).filter((p) => p.length > 0);
  if (paragraphs.length === 0) return null;
  const node = typed({ type: 'callout', content: [bold('Explanation'), ...paragraphs.map(para)] });
  return { kind: 'insert', targetId: null, afterId, before: null, after: [node], aiAdded: true, removesIds: [] };
}

// ---------------------------------------------------------------------------
// Cards and quiz
// ---------------------------------------------------------------------------

const CLOZE = /\{\{([^{}]+)\}\}/g;

/** Resolves an AI ref to the real block id, enforcing P2a's id pattern. */
function sourceId(ref: string, byAlias: ReadonlyMap<string, Unit>): string {
  const u = byAlias.get(ref);
  if (!u) throw new OutputRejected('unknown_ref');
  if (!P2A_BLOCK_ID.test(u.blockId)) throw new OutputRejected('source_id_pattern');
  return u.blockId;
}

/**
 * Cards -> CardDraft in P2a's fields. Rules:
 * - front 1..2,000 and back 0..2,000 UTF-16 units (P2a Firestore caps)
 * - basic / reversed need a back; cloze needs exactly one {{phrase}}
 * Duplicates (same type + front) across chunks are dropped.
 */
export function buildCards(out: CardsOut, chunk: readonly Unit[], already: Set<string>): CardDraft[] {
  const byAlias = new Map(chunk.map((u) => [u.alias, u]));
  const cards: CardDraft[] = [];
  for (const c of out.cards) {
    const front = clean(c.front);
    const back = clean(c.back);
    if (front.length < 1 || front.length > CARD_FRONT_MAX || back.length > CARD_BACK_MAX) throw new OutputRejected('card_length');
    if (c.type === 'cloze') {
      const holes = [...front.matchAll(CLOZE)];
      const stray = front.replace(CLOZE, '').includes('{{') || front.replace(CLOZE, '').includes('}}');
      if (holes.length !== 1 || stray || (holes[0]?.[1] ?? '').trim() === '') throw new OutputRejected('cloze_format');
    } else if (back.length === 0) {
      throw new OutputRejected('card_missing_back');
    }
    const sourceBlockId = sourceId(c.sourceRef, byAlias);
    const k = `${c.type}|${front.toLowerCase()}`;
    if (already.has(k)) continue;
    already.add(k);
    cards.push({ type: c.type, front, back, source: 'ai', sourceBlockId });
  }
  return cards;
}

/** Quiz -> QuizDraft. mcq: 3-5 distinct choices and a valid answerIndex; short: no choices. */
export function buildQuiz(out: QuizOut, chunk: readonly Unit[], already: Set<string>): QuizDraft[] {
  const byAlias = new Map(chunk.map((u) => [u.alias, u]));
  const qs: QuizDraft[] = [];
  for (const q of out.questions) {
    const question = clean(q.question);
    if (!question) throw new OutputRejected('empty_question');
    const sourceBlockId = sourceId(q.sourceRef, byAlias);
    let draft: QuizDraft;
    if (q.kind === 'mcq') {
      const choices = q.choices.map(clean);
      const distinct = new Set(choices.map((c) => c.toLowerCase()));
      if (choices.length < 3 || choices.some((c) => !c) || distinct.size !== choices.length) throw new OutputRejected('mcq_choices');
      if (q.answerIndex === null || q.answerIndex >= choices.length) throw new OutputRejected('mcq_answer');
      // The answer text always comes from the chosen option, so the two can't disagree.
      draft = { kind: 'mcq', question, choices, answerIndex: q.answerIndex, answer: choices[q.answerIndex] as string, sourceBlockId };
    } else {
      const answer = clean(q.answer);
      if (q.choices.length > 0 || q.answerIndex !== null || !answer) throw new OutputRejected('short_format');
      draft = { kind: 'short', question, choices: [], answerIndex: null, answer, sourceBlockId };
    }
    const k = question.toLowerCase();
    if (already.has(k)) continue;
    already.add(k);
    qs.push(draft);
  }
  return qs;
}

