/**
 * Turns stored strokes into ready-to-draw path items for the editor page
 * (and, from P6, for export HTML). Coordinates stay in BLOCK UNITS (§1.1):
 * the page scales them with an SVG viewBox of 0 0 1000 1000 over the block,
 * so items never need recomputing when the layout changes.
 *
 *  - Highlighter strokes and pens without pressure: a constant-width
 *    centreline (§4.4), drawn with round caps; layer 'under' for the
 *    highlighter (behind the text), 'over' for pens.
 *  - Pens with pressure: a filled variable-width outline (§4.1-§4.4).
 *
 * Strokes are immutable (an edit = tombstone + new id), so each stroke
 * object's item is computed once and cached (WeakMap: freed with the stroke).
 *
 * The item shape matches the editor bridge's inkItemSchema (structural
 * typing; the ink module doesn't import the editor's internals). Path data
 * comes only from geometry/svg.ts, whose output alphabet is SAFE_PATH.
 */
import type { InkLayer, InkStroke } from './model/format';
import { strokePoints } from './model/codec';
import { isConstantWidth, strokeOutline } from './geometry/outline';
import { centerlinePath, polygonPath } from './geometry/svg';

export interface InkRenderItem {
  id: string;
  b: string;
  layer: 'under' | 'over';
  mode: 'stroke' | 'fill';
  /** Width in block units (used by 'stroke'). */
  w: number;
  c: string;
  d: string;
}

const cache = new WeakMap<InkStroke, InkRenderItem>();

/** The draw item for one stroke (cached per stroke object). */
export function renderStroke(s: InkStroke): InkRenderItem {
  const hit = cache.get(s);
  if (hit) return hit;
  const pts = strokePoints(s);
  const width = s.w / 10; // tenths of a unit -> units (§1.3)
  const constant = s.tool === 'hl' || isConstantWidth(pts);
  const item: InkRenderItem = constant
    ? { id: s.id, b: s.b, layer: s.tool === 'hl' ? 'under' : 'over', mode: 'stroke', w: width, c: s.c, d: centerlinePath(pts) }
    : { id: s.id, b: s.b, layer: 'over', mode: 'fill', w: width, c: s.c, d: polygonPath(strokeOutline(pts, width)) };
  cache.set(s, item);
  return item;
}

/** Items for every stroke in a layer (first load, or after the page restarted). */
export function renderLayer(layer: InkLayer): InkRenderItem[] {
  return layer.strokes.map(renderStroke);
}

/**
 * What changed between two layers, for the page: ids to remove and items to
 * add. Ids identify strokes completely (strokes are immutable), so a plain
 * set difference is exact.
 */
export function renderDiff(prev: InkLayer | null, next: InkLayer): { remove: string[]; add: InkRenderItem[] } {
  const before = new Set(prev?.strokes.map((s) => s.id) ?? []);
  const after = new Set(next.strokes.map((s) => s.id));
  const remove = [...before].filter((id) => !after.has(id));
  const add = next.strokes.filter((s) => !before.has(s.id)).map(renderStroke);
  return { remove, add };
}
