/**
 * Hit testing for the eraser (§7) and the lasso (§8).
 * docs/modules/INK_MATH.md has the derivations; section numbers below match.
 *
 * Every function works in ONE coordinate space chosen by the caller (the
 * controller converts strokes to page px first, so strokes anchored to
 * different blocks can be tested together).
 */
import type { InkPoint } from '../model/codec';

/**
 * §7.1 Distance from point P to segment AB. Projects P on the line AB,
 * clamps the projection parameter t to [0, 1], then measures:
 *   t = ((P-A)·(B-A)) / |B-A|²,   d = |P - (A + t (B-A))|
 * A zero-length segment degenerates to the distance P-A.
 */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  'worklet';
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * vx - px;
  const cy = ay + t * vy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

/**
 * §7.2 Does a circle (eraser tip, centre c, radius r) touch a stroke drawn
 * with half-width h? True when some segment comes within r + h of c.
 * A one-point stroke (a dot) is tested as a point.
 */
export function strokeTouchesCircle(points: readonly InkPoint[], halfWidth: number, cx: number, cy: number, r: number): boolean {
  const reach = r + halfWidth;
  if (points.length === 1) {
    const p = points[0] as InkPoint;
    return Math.hypot(p.x - cx, p.y - cy) <= reach;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as InkPoint;
    const b = points[i] as InkPoint;
    if (distToSegment(cx, cy, a.x, a.y, b.x, b.y) <= reach) return true;
  }
  return false;
}

/**
 * §7.3 Parameter interval [t0, t1] where segment A + t(B-A) lies inside the
 * circle |X - C| <= r, intersected with [0, 1]; null when it never enters.
 * Solves |A + tV - C|² = r²:  (V·V) t² + 2 (V·W) t + (W·W - r²) = 0, W = A - C.
 */
export function segmentCircleInterval(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number,
): [number, number] | null {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = ax - cx;
  const wy = ay - cy;
  const a = vx * vx + vy * vy;
  const c = wx * wx + wy * wy - r * r;
  if (a === 0) return c <= 0 ? [0, 1] : null; // zero-length segment: inside or not
  const b = 2 * (vx * wx + vy * wy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = Math.max(0, (-b - s) / (2 * a));
  const t1 = Math.min(1, (-b + s) / (2 * a));
  return t0 <= t1 ? [t0, t1] : null;
}

const lerpPoint = (a: InkPoint, b: InkPoint, t: number): InkPoint => {
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  if (a.p === undefined || b.p === undefined) return { x, y };
  return { x, y, p: a.p + (b.p - a.p) * t };
};

/** Length of a polyline (same units as its points). */
export function polylineLength(points: readonly InkPoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as InkPoint;
    const b = points[i] as InkPoint;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/**
 * §7.4 Partial eraser: cuts every part of the polyline that lies within
 * radius r (+ the stroke's half-width) of the eraser centre and returns the
 * pieces that remain, in order. Cut points are exact (§7.3) with pressure
 * interpolated linearly. Pieces shorter than minLength are dropped (crumbs).
 * Returns null when the eraser doesn't touch the stroke at all, so callers
 * can tell "unchanged" from "erased completely" ([]).
 */
export function erasePartial(
  points: readonly InkPoint[], halfWidth: number, cx: number, cy: number, r: number, minLength = 1,
): InkPoint[][] | null {
  const reach = r + halfWidth;
  if (!strokeTouchesCircle(points, halfWidth, cx, cy, r)) return null;
  if (points.length === 1) return [];
  const pieces: InkPoint[][] = [];
  const first = points[0] as InkPoint;
  let run: InkPoint[] = Math.hypot(first.x - cx, first.y - cy) <= reach ? [] : [first];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as InkPoint;
    const b = points[i] as InkPoint;
    const cut = segmentCircleInterval(a.x, a.y, b.x, b.y, cx, cy, reach);
    if (!cut) {
      if (run.length === 0) run.push(a);
      run.push(b);
      continue;
    }
    const [t0, t1] = cut;
    if (t0 > 0) {
      if (run.length === 0) run.push(a);
      run.push(lerpPoint(a, b, t0));
    }
    if (run.length) pieces.push(run);
    run = [];
    if (t1 < 1) run.push(lerpPoint(a, b, t1), b);
  }
  if (run.length) pieces.push(run);
  return pieces.filter((pc) => pc.length >= 2 && polylineLength(pc) >= minLength);
}

/**
 * §8.1 Point in polygon by ray casting (even-odd rule): count crossings of a
 * horizontal ray from P to +x with each polygon edge; odd = inside. Works for
 * concave lassos; self-intersecting lassos use even-odd.
 */
export function pointInPolygon(x: number, y: number, poly: readonly InkPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as InkPoint;
    const b = poly[j] as InkPoint;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** §8.2 A stroke is selected when at least `share` of its points are inside the lasso. */
export function strokeInLasso(points: readonly InkPoint[], lasso: readonly InkPoint[], share = 0.5): boolean {
  if (lasso.length < 3 || points.length === 0) return false;
  let inside = 0;
  for (const p of points) if (pointInPolygon(p.x, p.y, lasso)) inside++;
  return inside / points.length >= share;
}
