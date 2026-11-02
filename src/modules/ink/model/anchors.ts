/**
 * Anchors: how a stroke is tied to a block (docs/modules/INK_MATH.md §9).
 *
 * The editor WebView reports a LAYOUT: the box of every block that has a
 * blockId, in page px (document coordinates, independent of scrolling).
 * A stroke is stored relative to ONE block (its anchor); when text above it
 * grows, the block moves and the stroke moves with it (decision Q3).
 *
 * Choosing an anchor (§9.1): the DEEPEST block whose box contains the
 * stroke's centre (a list item's paragraph rather than the whole list; ties:
 * the smaller box). If no box contains it (a margin, the space after the last
 * line), the nearest top-level block ABOVE the centre; if there's none above,
 * the first block.
 */
import { decodePoints, encodePoints, pxToUnits, strokeBounds, unitsToPx, type BlockBox, type InkPoint } from './codec';
import type { InkStroke } from './format';
import { INK_LIMITS as L, INK_UNIT } from './limits';

export interface LayoutBlock extends BlockBox {
  id: string;
  /** 0 = top-level block, 1 = inside a list/column/box, ... */
  depth: number;
  /** A sketch block (decision Q2): its ink is clipped to its frame. */
  sketch?: boolean;
}

export interface InkLayout {
  /** Page width in CSS px (the editor content width). */
  pageWidth: number;
  blocks: LayoutBlock[];
}

/** Index for fast lookups by id. */
export function indexLayout(layout: InkLayout): Map<string, LayoutBlock> {
  return new Map(layout.blocks.map((b) => [b.id, b] as const));
}

const contains = (b: BlockBox, x: number, y: number) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;

/** §9.1 The anchor block for a point (normally the stroke's centre). */
export function pickAnchor(layout: InkLayout, x: number, y: number): LayoutBlock | null {
  let best: LayoutBlock | null = null;
  for (const b of layout.blocks) {
    if (!contains(b, x, y)) continue;
    if (!best || b.depth > best.depth || (b.depth === best.depth && b.width * b.height < best.width * best.height)) best = b;
  }
  if (best) return best;
  let above: LayoutBlock | null = null;
  for (const b of layout.blocks) {
    if (b.depth !== 0 || b.top > y) continue;
    if (!above || b.top > above.top) above = b;
  }
  if (above) return above;
  // Nothing above: the first top-level block in page order.
  let first: LayoutBlock | null = null;
  for (const b of layout.blocks) if (b.depth === 0 && (!first || b.top < first.top)) first = b;
  return first;
}

/** Centre of a list of points' bounding box. */
export function centreOf(points: readonly InkPoint[]): InkPoint {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** A stroke's points in page px, given its anchor's box (pressure kept as 0..1). */
export function strokeToPx(s: InkStroke, box: BlockBox): InkPoint[] {
  const flat = decodePoints(s);
  const out: InkPoint[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const pr = s.p?.[i / 2];
    const pt: InkPoint = pr === undefined ? { x: flat[i] as number, y: flat[i + 1] as number } : { x: flat[i] as number, y: flat[i + 1] as number, p: pr / 100 };
    out.push(unitsToPx(pt, box));
  }
  return out;
}

/** Stroke width in page px for a given anchor box (§1.3). */
export function widthPx(s: Pick<InkStroke, 'w'>, box: BlockBox): number {
  return (s.w / 10) * (Math.max(1, box.width) / INK_UNIT);
}

/** Centre of a stroke in page px. */
export function strokeCentrePx(s: InkStroke, box: BlockBox): InkPoint {
  const [x0, y0, x1, y1] = strokeBounds(s);
  return unitsToPx({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, box);
}

/**
 * §9.2 Re-expresses a stroke relative to another block, optionally moved by
 * (dx, dy) page px, keeping its position and width ON THE PAGE. Returns a
 * stroke with the SAME id: the caller decides on a new id (strokes are
 * immutable once stored, so callers pass the result through applyOp with a
 * fresh id; see moveStrokes / reconcile).
 */
export function reexpress(s: InkStroke, fromBox: BlockBox, to: LayoutBlock, dx = 0, dy = 0): InkStroke {
  const px = strokeToPx(s, fromBox).map((p) => (p.p === undefined ? { x: p.x + dx, y: p.y + dy } : { x: p.x + dx, y: p.y + dy, p: p.p }));
  const enc = encodePoints(px.map((p) => pxToUnits(p, to)));
  const w = Math.min(L.maxWidth, Math.max(L.minWidth, Math.round(widthPx(s, fromBox) * (INK_UNIT / Math.max(1, to.width)) * 10)));
  const out: InkStroke = { ...s, b: to.id, w, o: enc.o, d: enc.d };
  if (enc.p) out.p = enc.p;
  else delete out.p;
  return out;
}
