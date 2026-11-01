/**
 * Turns one finished pen gesture (raw samples in page px) into stored strokes.
 *
 * Pipeline (each step is in docs/modules/INK_MATH.md):
 *   1. smooth in px with the SAME function the live overlay uses (§2), so the
 *      committed stroke lands exactly where the live one was drawn;
 *   2. convert to the anchor block's units (§1.2);
 *   3. simplify with RDP, epsilon 0.35 units (§5);
 *   4. split into pieces of at most maxPointsPerStroke points, consecutive
 *      pieces sharing their joint point so the line stays continuous (§6.4);
 *   5. quantise and delta-encode (§6.1).
 * Highlighter strokes are constant width: pressure is dropped.
 */
import { pxToUnits, encodePoints, type BlockBox, type InkPoint } from './codec';
import type { InkRecAnchor, InkStroke, InkTool } from './format';
import { INK_LIMITS as L, INK_UNIT } from './limits';
import { smoothStroke } from '../geometry/smooth';
import { simplify } from '../geometry/simplify';

export interface BuildInput {
  /** Raw pen samples in page px, in order (pressure 0..1 when reported). */
  raw: readonly InkPoint[];
  /** The anchor block id and its box at the time of drawing (page px). */
  anchor: string;
  box: BlockBox;
  tool: InkTool;
  /** Pack key or "#RRGGBB" (validated by the caller's tool settings). */
  color: string;
  /** Nominal width in page px. */
  widthPx: number;
  now: number;
  newStrokeId: () => string;
  rec?: InkRecAnchor;
}

/** px width -> stored width in tenths of a unit (§1.3), clamped to the allowed range. */
export function widthToTenths(widthPx: number, box: BlockBox): number {
  const tenths = Math.round(((widthPx * INK_UNIT) / Math.max(1, box.width)) * 10);
  return Math.min(L.maxWidth, Math.max(L.minWidth, tenths));
}

/** Splits points into runs of at most `max`, each run starting at the previous run's last point. */
export function splitPoints(points: readonly InkPoint[], max: number = L.maxPointsPerStroke): InkPoint[][] {
  if (points.length <= max) return [points.slice()];
  const out: InkPoint[][] = [];
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(points.length, start + max);
    out.push(points.slice(start, end));
    start = end - 1; // share the joint point
  }
  return out;
}

export function buildStrokes(input: BuildInput): InkStroke[] {
  if (input.raw.length === 0) return [];
  const usePressure = input.tool === 'pen';
  const raw = usePressure ? input.raw : input.raw.map((p) => ({ x: p.x, y: p.y }));
  const smoothed = smoothStroke(raw);
  const units = smoothed.map((p) => pxToUnits(p, input.box));
  const simple = simplify(units);
  const w = widthToTenths(input.widthPx, input.box);
  // Split with a 100-point margin: encodePoints may subdivide steps longer than
  // maxStep, which adds at most 1 point per 4,000 units of travel (<= 25 within
  // the coordinate bounds), so every piece stays under maxPointsPerStroke.
  return splitPoints(simple, L.maxPointsPerStroke - 100).map((pts) => {
    const enc = encodePoints(pts);
    const s: InkStroke = { id: input.newStrokeId(), b: input.anchor, tool: input.tool, c: input.color, w, o: enc.o, d: enc.d, t: input.now };
    if (enc.p) s.p = enc.p;
    if (input.rec) s.rec = { r: input.rec.r, ms: input.rec.ms };
    return s;
  });
}
