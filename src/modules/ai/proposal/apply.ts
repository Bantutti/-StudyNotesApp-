/**
 * Apply, rebase and undo. Pure functions over core's NoteDoc.
 *
 * - findStaleChanges: block-level rebase check (Rey Nov 1, Q7 = A). A change
 *   whose target block changed (or disappeared) since the proposal is "stale"
 *   and is turned off; the rest still apply. ALGORITHMS §6.1.
 * - applyProposal: one rebuild pass over the tree (§6.2), then invariant
 *   checks (§6.3). If any check fails it returns an error and the caller's
 *   document is untouched. It never returns a broken document.
 * - undoApply: exact undo (§7). Allowed only while the note is byte-for-byte
 *   (canonically) the document applyProposal produced.
 */
import {
  ensureBlockIds,
  fail,
  listBlockIds,
  ok,
  validateNoteDoc,
  type DocNode,
  type IdGenerator,
  type NoteDoc,
  type Result,
} from '@/core';

import { AiError } from '../errors';
import { blockIdOf, canonicalJson, hasCompleteIds, idsIn, loose, typed, type LooseNode } from '../document/nodes';
import type { ApplyResult, BlockChange, Proposal, UndoRecord } from './types';

/** Retries if a freshly generated id collides with an existing one (§6.2). */
const MAX_ID_ATTEMPTS = 8;

/** id -> node for every block in the document (one walk). */
function indexNodes(doc: NoteDoc): Map<string, DocNode> {
  const map = new Map<string, DocNode>();
  const stack: DocNode[] = [...doc.content];
  while (stack.length > 0) {
    const n = stack.pop() as DocNode;
    const id = blockIdOf(n);
    if (id) map.set(id, n);
    for (const c of loose(n).content ?? []) stack.push(typed(c));
  }
  return map;
}

/**
 * §6.1 A change is stale when:
 * - replace/delete: its target is missing, or no longer canonically equal to
 *   the snapshot taken when the proposal was made;
 * - insert: its anchor block is missing (null anchor = start of note, never stale).
 */
export function findStaleChanges(currentRaw: NoteDoc, proposal: Pick<Proposal, 'changes'>): string[] {
  // Compare like with like: snapshots were taken from a validated (zod-parsed)
  // document, so validate here too. An invalid note makes every change stale.
  const v = validateNoteDoc(currentRaw);
  if (!v.ok) return proposal.changes.map((c) => c.changeId);
  const index = indexNodes(v.value);
  const stale: string[] = [];
  for (const c of proposal.changes) {
    if (c.kind === 'insert') {
      if (c.afterId !== null && !index.has(c.afterId)) stale.push(c.changeId);
      continue;
    }
    const node = c.targetId ? index.get(c.targetId) : undefined;
    if (!node || !c.before || canonicalJson(node) !== canonicalJson(c.before)) stale.push(c.changeId);
  }
  return stale;
}

const invariant = (reason: string) => fail<never>(new AiError('internal', { reason }));

export function applyProposal(
  currentRaw: NoteDoc,
  proposal: Proposal,
  acceptedChangeIds: readonly string[],
  ids: IdGenerator,
): Result<ApplyResult> {
  // 1. The current note must be valid and fully id'd (P1 guarantees this).
  const v = validateNoteDoc(currentRaw);
  if (!v.ok || !hasCompleteIds(v.value, ids)) return fail(new AiError('invalid_input', { reason: 'doc_not_ready' }));
  const current = v.value;

  // 2. Accepted changes, minus the stale ones.
  const byId = new Map(proposal.changes.map((c) => [c.changeId, c]));
  for (const id of acceptedChangeIds) if (!byId.has(id)) return fail(new AiError('invalid_input', { reason: 'unknown_change' }));
  const accepted = proposal.changes.filter((c) => acceptedChangeIds.includes(c.changeId));
  const staleSet = new Set(findStaleChanges(current, { changes: accepted }));
  const active = accepted.filter((c) => !staleSet.has(c.changeId));

  // 3. Index the active changes by where they act.
  const replaceBy = new Map<string, BlockChange>();
  const deleteBy = new Map<string, BlockChange>();
  const insertsAfter = new Map<string | null, BlockChange[]>();
  for (const c of active) {
    if (c.kind === 'replace' && c.targetId) replaceBy.set(c.targetId, c);
    else if (c.kind === 'delete' && c.targetId) deleteBy.set(c.targetId, c);
    else if (c.kind === 'insert') insertsAfter.set(c.afterId, [...(insertsAfter.get(c.afterId) ?? []), c]);
  }

  const existing = new Set(listBlockIds(current));
  const assigned = new Set<string>();
  const applied = new Set<string>();
  const droppedEmptyLists: string[] = [];
  let collision = false;

  /** §6.2 Assigns ids to id-less blocks in `node`, never reusing an existing id. */
  const freshen = (node: DocNode): DocNode => {
    const had = new Set(idsIn([node]));
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
      const withIds = ensureBlockIds({ type: 'doc', content: [node] }, ids).content[0] as DocNode;
      const fresh = idsIn([withIds]).filter((id) => !had.has(id));
      const clash = fresh.some((id) => existing.has(id) || assigned.has(id)) || new Set(fresh).size !== fresh.length;
      if (!clash) {
        fresh.forEach((id) => assigned.add(id));
        return withIds;
      }
    }
    collision = true;
    return node;
  };

  const emitInserts = (key: string | null, out: DocNode[]) => {
    for (const c of insertsAfter.get(key) ?? []) {
      for (const n of c.after) out.push(freshen(n));
      applied.add(c.changeId);
    }
  };

  /** §6.2 Single pass: rebuild a node list, applying replaces, deletes and inserts. */
  const rebuild = (nodes: readonly DocNode[], isTop: boolean): DocNode[] => {
    const out: DocNode[] = [];
    if (isTop) emitInserts(null, out);
    for (const node of nodes) {
      const id = blockIdOf(node);
      const rep = id ? replaceBy.get(id) : undefined;
      if (rep) {
        // Children of a replacement may hold other changes' targets (e.g. a
        // nested list item kept under a rewritten parent), so rebuild them too.
        for (const n of rep.after) out.push(freshen(withRebuiltChildren(n)));
        applied.add(rep.changeId);
      } else if (id && deleteBy.has(id)) {
        applied.add((deleteBy.get(id) as BlockChange).changeId);
      } else {
        const rebuilt = withRebuiltChildren(node);
        const l = loose(rebuilt);
        const isList = l.type === 'bulletList' || l.type === 'orderedList';
        if (isList && (l.content ?? []).length === 0) {
          if (id) droppedEmptyLists.push(id); // a list whose items were all deleted
        } else {
          out.push(rebuilt);
        }
      }
      if (id) emitInserts(id, out);
    }
    return out;
  };

  /** Copy of `node` with its block children rebuilt (text children pass through). */
  const withRebuiltChildren = (node: DocNode): DocNode => {
    const l = loose(node);
    if (!l.content || l.content.length === 0) return node;
    const kids = rebuild(l.content.map(typed), false);
    const next: LooseNode = { ...l, content: kids as unknown as LooseNode[] };
    if (kids.length === 0) delete next.content;
    return typed(next);
  };

  const rebuiltDoc: NoteDoc = { type: 'doc', content: rebuild(current.content, true) };
  if (collision) return invariant('id_collision');

  // 4. §6.3 Invariants. Any failure: return an error, change nothing.
  if ([...active].some((c) => !applied.has(c.changeId))) return invariant('change_not_applied');
  const checked = validateNoteDoc(rebuiltDoc);
  if (!checked.ok) return invariant('result_invalid');
  const result = checked.value;
  const resultIds = listBlockIds(result);
  const resultSet = new Set(resultIds);
  if (resultSet.size !== resultIds.length) return invariant('duplicate_ids');
  if (!hasCompleteIds(result, ids)) return invariant('ids_incomplete');
  const allowedGone = new Set<string>([...active.flatMap((c) => c.removesIds), ...droppedEmptyLists]);
  for (const id of existing) {
    if (!resultSet.has(id) && !allowedGone.has(id)) return invariant('id_lost');
  }

  const beforeJson = canonicalJson(current);
  const afterJson = canonicalJson(result);
  return ok({
    doc: result,
    undo: { proposalId: proposal.id, beforeJson, afterJson, snapshotReason: proposal.snapshotReason },
    appliedChangeIds: active.map((c) => c.changeId),
    staleChangeIds: accepted.filter((c) => staleSet.has(c.changeId)).map((c) => c.changeId),
    changedBlockIds: changedIds(current, result, active),
    newBlockIds: resultIds.filter((id) => !existing.has(id)),
    removedBlockIds: [...existing].filter((id) => !resultSet.has(id)),
  });
}

/** A node without its nested lists: what "its own content" means for a list item. */
function ownView(node: DocNode | undefined): string {
  if (!node) return '';
  const l = loose(node);
  const content = (l.content ?? []).filter((c) => c.type !== 'bulletList' && c.type !== 'orderedList');
  return canonicalJson({ ...l, content });
}

/**
 * Existing blocks whose own content changed: every kept id inside a replace's
 * new nodes (the target and any inner paragraphs that inherited an id) whose
 * own view differs. P4c uses this to mark cards "Source changed".
 */
function changedIds(before: NoteDoc, after: NoteDoc, active: readonly BlockChange[]): string[] {
  const b = indexNodes(before);
  const a = indexNodes(after);
  const out = new Set<string>();
  for (const c of active) {
    if (c.kind !== 'replace') continue;
    for (const id of idsIn(c.after)) {
      if (b.has(id) && a.has(id) && ownView(b.get(id)) !== ownView(a.get(id))) out.add(id);
    }
  }
  return [...out];
}

/**
 * §7 Exact undo: returns the document from before the apply, but only if
 * the note is still exactly what applyProposal produced. Otherwise 'stale'
 * (P3b then offers version history instead).
 */
export function undoApply(currentRaw: NoteDoc, undo: UndoRecord): Result<NoteDoc> {
  const v = validateNoteDoc(currentRaw);
  if (!v.ok || canonicalJson(v.value) !== undo.afterJson) return fail(new AiError('stale'));
  let before: unknown;
  try {
    before = JSON.parse(undo.beforeJson);
  } catch {
    return fail(new AiError('internal', { reason: 'undo_corrupt' }));
  }
  const restored = validateNoteDoc(before);
  if (!restored.ok) return fail(new AiError('internal', { reason: 'undo_corrupt' }));
  return ok(restored.value);
}
