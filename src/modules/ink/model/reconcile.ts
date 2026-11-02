/**
 * Reconcile: keeps strokes attached after a text edit (decision Q4,
 * docs/modules/INK_MATH.md §9.3).
 *
 * Most edits need nothing: typing, moving blocks, Beautify, AI edits and
 * turn-into all KEEP block ids, and strokes follow their id. Splitting a
 * block keeps the id on the top half, so its strokes stay where they were.
 *
 * The one edit that deletes an id while keeping its text is a JOIN
 * (Backspace at the start of a line, or Delete at the end of the line
 * above): ProseMirror appends block X's text to the textblock Y before it,
 * and X's id disappears. reconcile() detects it by TEXT:
 *     text_next(Y) == text_prev(Y) + text_prev(X)
 * where Y is the textblock just before X in document order, and moves X's
 * strokes to Y, keeping their position on the page (anchors.reexpress, using
 * the layout from BEFORE the edit, when both boxes were known).
 *
 * Any other missing anchor (the block was deleted) is left alone: those
 * strokes are DETACHED (hidden, still in the layer). Undo, version restore or
 * sync can bring the block back, and the strokes reappear by themselves.
 */
import { getBlockId, inlineText, type DocNode, type NoteDoc } from '@/core';

import { indexLayout, reexpress, type InkLayout } from './anchors';
import type { InkLayer, InkStroke } from './format';
import { applyOp, type InkOp, type OpContext } from './layer';

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'qaQuestion']);

interface TextblockInfo {
  id: string;
  text: string;
}

/** Textblocks with ids, in document order, plus the set of every block id. */
export function scanDoc(doc: NoteDoc): { textblocks: TextblockInfo[]; ids: Set<string> } {
  const textblocks: TextblockInfo[] = [];
  const ids = new Set<string>();
  // Iterative pre-order walk (document order), no recursion.
  const stack: DocNode[] = [...doc.content].reverse();
  while (stack.length) {
    const n = stack.pop() as DocNode;
    const id = getBlockId(n);
    if (id) {
      ids.add(id);
      if (TEXTBLOCKS.has(n.type)) textblocks.push({ id, text: inlineText(n) });
    }
    if ('content' in n && n.content) for (let i = n.content.length - 1; i >= 0; i--) stack.push(n.content[i] as DocNode);
  }
  return { textblocks, ids };
}

export interface ReconcileResult {
  layer: InkLayer;
  /** What changed, for diagnostics and tests (null when nothing did). */
  applied: InkOp | null;
  /** Old stroke id -> new id, for InkHistory.remap(). */
  idMap: Map<string, string>;
}

/**
 * Moves strokes of joined blocks onto the block they were joined into.
 * `prevLayout` must be the layout reported BEFORE the edit (the controller
 * keeps the last one). Without it, nothing is moved (strokes stay detached
 * and remain recoverable).
 */
export function reconcile(prevDoc: NoteDoc, nextDoc: NoteDoc, layer: InkLayer, prevLayout: InkLayout | null, ctx: OpContext): ReconcileResult {
  const none: ReconcileResult = { layer, applied: null, idMap: new Map() };
  if (layer.strokes.length === 0 || !prevLayout) return none;

  const next = scanDoc(nextDoc);
  const orphaned = layer.strokes.filter((s) => !next.ids.has(s.b));
  if (orphaned.length === 0) return none;

  const prev = scanDoc(prevDoc);
  const prevIndex = new Map(prev.textblocks.map((tb, i) => [tb.id, i] as const));
  const nextText = new Map(next.textblocks.map((tb) => [tb.id, tb.text] as const));
  const boxes = indexLayout(prevLayout);

  // Which missing anchor was joined into which surviving textblock?
  const joinedInto = new Map<string, string>();
  for (const anchor of new Set(orphaned.map((s) => s.b))) {
    const i = prevIndex.get(anchor);
    if (i === undefined || i === 0) continue;
    const x = prev.textblocks[i] as TextblockInfo;
    const y = prev.textblocks[i - 1] as TextblockInfo;
    const yNow = nextText.get(y.id);
    if (yNow !== undefined && yNow === y.text + x.text) joinedInto.set(anchor, y.id);
  }
  if (joinedInto.size === 0) return none;

  const remove: InkStroke[] = [];
  const add: InkStroke[] = [];
  const idMap = new Map<string, string>();
  for (const s of orphaned) {
    const target = joinedInto.get(s.b);
    const fromBox = boxes.get(s.b);
    const toBox = target ? boxes.get(target) : undefined;
    if (!target || !fromBox || !toBox) continue;
    const moved = { ...reexpress(s, fromBox, toBox), id: ctx.newStrokeId() };
    remove.push(s);
    add.push(moved);
    idMap.set(s.id, moved.id);
  }
  if (remove.length === 0) return none;
  const r = applyOp(layer, { remove, add }, ctx);
  if (!r.ok) return none;
  // applyOp may have renamed again (it never does for fresh ids, but stay exact).
  for (const [oldId, midId] of idMap) idMap.set(oldId, r.idMap.get(midId) ?? midId);
  return { layer: r.layer, applied: r.applied, idMap };
}
