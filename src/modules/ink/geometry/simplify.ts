/**
 * Ramer–Douglas–Peucker simplification (docs/modules/INK_MATH.md §5).
 *
 * Keeps the first and last points; recursively keeps the point farthest from
 * the chord between two kept points while that distance exceeds epsilon.
 * Every dropped point is within epsilon of the simplified polyline (§5.2), so
 * with epsilon = 0.35 units (about 0.1-0.3 px) the change is invisible while
 * typical strokes shrink by 50-80%.
 *
 * Iterative (explicit stack), so a 2,000-point stroke can't overflow the JS
 * stack. Pressure values travel with their points.
 */
import type { InkPoint } from '../model/codec';
import { distToSegment } from './hit';

/** Default tolerance in block units (§5.2). */
export const SIMPLIFY_EPSILON = 0.35;

export function simplify(points: readonly InkPoint[], epsilon: number = SIMPLIFY_EPSILON): InkPoint[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const A = points[a] as InkPoint;
    const B = points[b] as InkPoint;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const P = points[i] as InkPoint;
      const dd = distToSegment(P.x, P.y, A.x, A.y, B.x, B.y);
      if (dd > maxD) {
        maxD = dd;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: InkPoint[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i] as InkPoint);
  return out;
}
