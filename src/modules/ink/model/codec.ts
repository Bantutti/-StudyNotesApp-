/**
 * Coordinate transforms and the point codec.
 *
 *  - §1.2 page pixels <-> block units (1000 units = anchor block width; the
 *    SAME scale on x and y, so a stroke keeps its shape when the block is
 *    wider or narrower on another device).
 *  - §6.1 quantise + delta-encode: each ABSOLUTE coordinate is rounded first,
 *    then deltas are taken between rounded values, so rounding errors never
 *    accumulate along a stroke (max error 0.5 units per point, §6.2).
 *  - §6.2 bounds: points are clamped into INK_LIMITS and any step longer than
 *    maxStep is subdivided, so encode() can only produce valid strokes.
 *
 * Every function here is a worklet-safe pure function (plain math on arrays).
 */
import { INK_LIMITS as L, INK_UNIT } from './limits';

/** A point in some 2-D space (page px or block units), with optional pressure 0..1. */
export interface InkPoint {
  x: number;
  y: number;
  p?: number;
}

/** Where a block sits on the page, in CSS px of the editor page (layout.ts). */
export interface BlockBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** §1.2 px -> units for one block. A zero-width box is treated as 1 px (never divide by 0). */
export function pxToUnits(pt: InkPoint, box: BlockBox): InkPoint {
  'worklet';
  const k = INK_UNIT / Math.max(1, box.width);
  return pt.p === undefined
    ? { x: (pt.x - box.left) * k, y: (pt.y - box.top) * k }
    : { x: (pt.x - box.left) * k, y: (pt.y - box.top) * k, p: pt.p };
}

/** §1.2 units -> px for one block (the inverse of pxToUnits). */
export function unitsToPx(pt: InkPoint, box: BlockBox): InkPoint {
  'worklet';
  const k = Math.max(1, box.width) / INK_UNIT;
  return pt.p === undefined
    ? { x: box.left + pt.x * k, y: box.top + pt.y * k }
    : { x: box.left + pt.x * k, y: box.top + pt.y * k, p: pt.p };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Rounds and clamps one coordinate pair into the storable range (§6.2). */
function quantize(x: number, y: number): [number, number] {
  const qx = Number.isFinite(x) ? Math.round(x) : 0;
  const qy = Number.isFinite(y) ? Math.round(y) : 0;
  return [clamp(qx, L.minX, L.maxX), clamp(qy, L.minY, L.maxY)];
}

/** Pressure 0..1 -> stored integer 0..100 (non-finite counts as 0). */
export function quantizePressure(p: number | undefined): number {
  if (p === undefined || !Number.isFinite(p)) return 0;
  return clamp(Math.round(p * 100), 0, L.maxPressure);
}

export interface EncodedPoints {
  o: [number, number];
  d: number[];
  /** Present only when at least one input point had a pressure value. */
  p?: number[];
}

/**
 * §6.1 Encodes points (in units) as origin + integer deltas.
 * - Consecutive duplicates after rounding are dropped (they draw nothing).
 * - Steps longer than maxStep are subdivided into equal parts (§6.2).
 * Requires at least one point; callers never encode an empty stroke.
 */
export function encodePoints(points: readonly InkPoint[]): EncodedPoints {
  const first = points[0] ?? { x: 0, y: 0 };
  const o = quantize(first.x, first.y);
  const hasP = points.some((pt) => pt.p !== undefined);
  const d: number[] = [];
  const p: number[] | undefined = hasP ? [quantizePressure(first.p)] : undefined;
  let px = o[0];
  let py = o[1];
  for (let i = 1; i < points.length; i++) {
    const pt = points[i] as InkPoint;
    const [qx, qy] = quantize(pt.x, pt.y);
    const dx = qx - px;
    const dy = qy - py;
    if (dx === 0 && dy === 0) continue;
    // Subdivide over-long steps into n parts, each within maxStep. Part k is
    // round(dx*k/n) - round(dx*(k-1)/n), so the parts sum exactly to dx.
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / L.maxStep);
    const pv = quantizePressure(pt.p);
    for (let k = 1; k <= n; k++) {
      d.push(Math.round((dx * k) / n) - Math.round((dx * (k - 1)) / n), Math.round((dy * k) / n) - Math.round((dy * (k - 1)) / n));
      if (p) p.push(pv);
    }
    px = qx;
    py = qy;
  }
  return p ? { o, d, p } : { o, d };
}

/** §6.1 Decodes a stroke's points to absolute units, as a flat [x0, y0, x1, y1, ...] array. */
export function decodePoints(s: { o: readonly [number, number] | number[]; d: readonly number[] }): number[] {
  const out: number[] = [s.o[0] as number, s.o[1] as number];
  let x = s.o[0] as number;
  let y = s.o[1] as number;
  for (let i = 0; i < s.d.length; i += 2) {
    x += s.d[i] as number;
    y += s.d[i + 1] as number;
    out.push(x, y);
  }
  return out;
}

/** Decoded points as objects, with pressure 0..1 when the stroke has it. */
export function strokePoints(s: { o: readonly [number, number] | number[]; d: readonly number[]; p?: readonly number[] }): InkPoint[] {
  const flat = decodePoints(s);
  const pts: InkPoint[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const pr = s.p?.[i / 2];
    pts.push(pr === undefined ? { x: flat[i] as number, y: flat[i + 1] as number } : { x: flat[i] as number, y: flat[i + 1] as number, p: pr / 100 });
  }
  return pts;
}

/** Bounding box of a stroke in units: [minX, minY, maxX, maxY]. */
export function strokeBounds(s: { o: readonly [number, number] | number[]; d: readonly number[] }): [number, number, number, number] {
  const flat = decodePoints(s);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i] as number;
    const y = flat[i + 1] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}
