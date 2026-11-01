/**
 * Variable-width stroke outline (docs/modules/INK_MATH.md §4).
 *
 * A pressure stroke can't be drawn as a plain "stroke" path (SVG and Skia
 * strokes have one width), so it is drawn as a FILLED polygon:
 *   - at each point P_i, radius r_i = (w / 2) * pressureFactor(p_i)  (§3.1)
 *   - tangent T_i = normalise(P_(i+1) - P_(i-1)) (one-sided at the ends),
 *     normal N_i = (-T_i.y, T_i.x)                                    (§4.1)
 *   - left edge L_i = P_i + r_i N_i, right edge R_i = P_i - r_i N_i   (§4.2)
 *   - polygon = L_0..L_(n-1), end cap, R_(n-1)..R_0, start cap; each cap is a
 *     half circle approximated by CAP_SEGMENTS chords                  (§4.3)
 * A single point becomes a full circle. Sharp turns can make the two edges
 * cross; the renderers fill with the non-zero rule, so overlaps stay solid.
 *
 * Constant-width strokes (no pressure, and every highlighter stroke) skip
 * this and use a round-capped centreline path instead (svg.ts), which is
 * smaller and exact.
 */
import type { InkPoint } from '../model/codec';
import { pressureFactor } from './smooth';

export const CAP_SEGMENTS = 6;
const CIRCLE_SEGMENTS = 12;

/** Is a stroke constant width? (No point carries pressure.) */
export function isConstantWidth(points: readonly InkPoint[]): boolean {
  'worklet';
  for (const p of points) if (p.p !== undefined) return false;
  return true;
}

/**
 * §4.3 Half circle around C starting at angle a0 and sweeping -pi (from the
 * left edge, through the outward direction, to the right edge), excluding
 * both end points (they are already edge vertices).
 */
function capPoints(out: InkPoint[], cx: number, cy: number, r: number, a0: number): void {
  'worklet';
  for (let k = 1; k < CAP_SEGMENTS; k++) {
    const a = a0 - (Math.PI * k) / CAP_SEGMENTS;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
}

/**
 * §4.1-§4.3 Outline polygon of a stroke with nominal width `width` (same
 * units as the points). Returns the polygon's vertices in drawing order.
 */
export function strokeOutline(points: readonly InkPoint[], width: number): InkPoint[] {
  'worklet';
  const n = points.length;
  const out: InkPoint[] = [];
  if (n === 0) return out;
  const half = width / 2;
  if (n === 1) {
    const p = points[0] as InkPoint;
    const r = half * pressureFactor(p.p);
    for (let k = 0; k < CIRCLE_SEGMENTS; k++) {
      const a = (2 * Math.PI * k) / CIRCLE_SEGMENTS;
      out.push({ x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) });
    }
    return out;
  }

  // §4.1 Normals. A zero-length tangent (repeated point) reuses the previous normal.
  const nx: number[] = [];
  const ny: number[] = [];
  let lastNx = 0;
  let lastNy = -1;
  for (let i = 0; i < n; i++) {
    const a = points[i === 0 ? 0 : i - 1] as InkPoint;
    const b = points[i === n - 1 ? n - 1 : i + 1] as InkPoint;
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const len = Math.sqrt(tx * tx + ty * ty);
    if (len > 1e-9) {
      lastNx = -ty / len;
      lastNy = tx / len;
    }
    nx.push(lastNx);
    ny.push(lastNy);
  }
  const radius = (i: number) => half * pressureFactor((points[i] as InkPoint).p);

  // §4.2 Left edge forward.
  for (let i = 0; i < n; i++) {
    const p = points[i] as InkPoint;
    const r = radius(i);
    out.push({ x: p.x + r * (nx[i] as number), y: p.y + r * (ny[i] as number) });
  }
  // §4.3 End cap: from L (angle of N) through the forward direction T (angle of N - pi/2) to R (angle of N - pi).
  const pe = points[n - 1] as InkPoint;
  capPoints(out, pe.x, pe.y, radius(n - 1), Math.atan2(ny[n - 1] as number, nx[n - 1] as number));
  // §4.2 Right edge backward.
  for (let i = n - 1; i >= 0; i--) {
    const p = points[i] as InkPoint;
    const r = radius(i);
    out.push({ x: p.x - r * (nx[i] as number), y: p.y - r * (ny[i] as number) });
  }
  // §4.3 Start cap: from R (angle of N + pi) through the backward direction -T (angle of N + pi/2) to L (angle of N).
  const ps = points[0] as InkPoint;
  capPoints(out, ps.x, ps.y, radius(0), Math.atan2(ny[0] as number, nx[0] as number) + Math.PI);
  return out;
}
