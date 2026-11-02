/**
 * SVG path data for strokes. Used by the editor WebView renderer, the live
 * Skia overlay (Skia.Path.MakeFromSVGString) and P6's export (§9 of the
 * module doc).
 *
 * SECURITY: these functions are the ONLY producers of path strings. Their
 * output alphabet is limited to "MLQZ", digits, space, "." and "-" (fmt()
 * clamps and rounds every number, so no exponent "e", NaN or Infinity can
 * appear). The renderer sets the result with setAttribute('d', ...) only.
 *
 * Curves (§4.4): points are joined with quadratic Béziers through segment
 * midpoints: control = P_i, end = midpoint(P_i, P_(i+1)). The curve passes
 * through every midpoint with a continuous tangent, which smooths the
 * polyline without overshoot.
 */
import type { InkPoint } from '../model/codec';

/** Coordinates are clamped to this magnitude before formatting (never reached in practice). */
const MAX_ABS = 1_000_000;

/** One number with at most one decimal, plain digits only. */
export function fmt(v: number): string {
  'worklet';
  if (!Number.isFinite(v)) return '0';
  const c = v > MAX_ABS ? MAX_ABS : v < -MAX_ABS ? -MAX_ABS : v;
  const r = Math.round(c * 10) / 10;
  return r === 0 ? '0' : String(r);
}

/** §4.4 Open centreline path (constant-width strokes, drawn with round caps and joins). */
export function centerlinePath(points: readonly InkPoint[]): string {
  'worklet';
  const n = points.length;
  if (n === 0) return '';
  const p0 = points[0] as InkPoint;
  // A dot: a zero-length line still draws a round cap in SVG and Skia.
  if (n === 1) return `M${fmt(p0.x)} ${fmt(p0.y)}L${fmt(p0.x)} ${fmt(p0.y)}`;
  if (n === 2) {
    const p1 = points[1] as InkPoint;
    return `M${fmt(p0.x)} ${fmt(p0.y)}L${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  let d = `M${fmt(p0.x)} ${fmt(p0.y)}`;
  for (let i = 1; i < n - 1; i++) {
    const a = points[i] as InkPoint;
    const b = points[i + 1] as InkPoint;
    d += `Q${fmt(a.x)} ${fmt(a.y)} ${fmt((a.x + b.x) / 2)} ${fmt((a.y + b.y) / 2)}`;
  }
  const last = points[n - 1] as InkPoint;
  return `${d}L${fmt(last.x)} ${fmt(last.y)}`;
}

/** §4.4 Closed smooth path through a polygon (variable-width outlines, filled non-zero). */
export function polygonPath(poly: readonly InkPoint[]): string {
  'worklet';
  const n = poly.length;
  if (n < 3) return '';
  const mid = (a: InkPoint, b: InkPoint) => [(a.x + b.x) / 2, (a.y + b.y) / 2] as const;
  const [sx, sy] = mid(poly[n - 1] as InkPoint, poly[0] as InkPoint);
  let d = `M${fmt(sx)} ${fmt(sy)}`;
  for (let i = 0; i < n; i++) {
    const a = poly[i] as InkPoint;
    const b = poly[(i + 1) % n] as InkPoint;
    const [mx, my] = mid(a, b);
    d += `Q${fmt(a.x)} ${fmt(a.y)} ${fmt(mx)} ${fmt(my)}`;
  }
  return `${d}Z`;
}

/** The characters a path string may contain (tests assert every output against this). */
export const SAFE_PATH = /^[MLQZ0-9 .-]*$/;
