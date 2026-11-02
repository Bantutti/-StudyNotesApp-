import { distToSegment, erasePartial, pointInPolygon, polylineLength, segmentCircleInterval, strokeInLasso, strokeTouchesCircle } from '../geometry/hit';
import { isConstantWidth, strokeOutline } from '../geometry/outline';
import { simplify } from '../geometry/simplify';
import { pressureFactor, smoothStep, smoothStroke } from '../geometry/smooth';
import { centerlinePath, fmt, polygonPath, SAFE_PATH } from '../geometry/svg';
import type { InkPoint } from '../model/codec';
import { rng } from './helpers';

const line = (n: number, dx = 1, dy = 0): InkPoint[] => Array.from({ length: n }, (_, i) => ({ x: i * dx, y: i * dy }));

/** Shoelace area (signed). */
function area(poly: readonly InkPoint[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as InkPoint;
    const q = poly[(i + 1) % poly.length] as InkPoint;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** True when no two non-adjacent polygon edges cross. */
function isSimple(poly: readonly InkPoint[]): boolean {
  const cross = (a: InkPoint, b: InkPoint, c: InkPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = poly[i] as InkPoint, b = poly[(i + 1) % n] as InkPoint, c = poly[j] as InkPoint, d = poly[(j + 1) % n] as InkPoint;
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
    }
  }
  return true;
}

describe('§2 smoothing', () => {
  it('keeps the first point and ends exactly at the last raw point', () => {
    const raw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }];
    const s = smoothStroke(raw);
    expect(s[0]).toEqual(raw[0]);
    expect(s[s.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('is incremental: step-by-step (live overlay) == whole stroke (commit)', () => {
    const r = rng(3);
    const raw = Array.from({ length: 200 }, (_, i) => ({ x: i + r() * 3, y: Math.sin(i / 10) * 30 + r() * 3, p: r() }));
    const whole = smoothStroke(raw);
    let prev = raw[0] as InkPoint;
    const live: InkPoint[] = [prev];
    for (let i = 1; i < raw.length; i++) {
      prev = smoothStep(prev, raw[i] as InkPoint);
      live.push(prev);
    }
    expect(whole.slice(0, live.length)).toEqual(live);
  });

  it('reduces jitter', () => {
    const r = rng(9);
    const raw = Array.from({ length: 300 }, (_, i) => ({ x: i, y: (r() - 0.5) * 4 }));
    const s = smoothStroke(raw);
    const rough = (pts: InkPoint[]) => pts.slice(1).reduce((acc, p, i) => acc + Math.abs(p.y - (pts[i] as InkPoint).y), 0);
    expect(rough(s)).toBeLessThan(rough(raw) * 0.6);
  });

  it('§3.1 maps pressure to a width factor in [0.4, 1.3], 1 without pressure', () => {
    expect(pressureFactor(undefined)).toBe(1);
    expect(pressureFactor(NaN)).toBe(1);
    expect(pressureFactor(0)).toBe(0.4);
    expect(pressureFactor(1)).toBe(1.3);
    expect(pressureFactor(2 / 3)).toBeCloseTo(1);
  });
});

describe('§5 RDP simplification', () => {
  it('keeps endpoints and every dropped point is within epsilon', () => {
    const r = rng(11);
    const pts = Array.from({ length: 400 }, (_, i) => ({ x: i * 0.5, y: Math.sin(i / 25) * 20 + r() * 0.2 }));
    const eps = 0.35;
    const s = simplify(pts, eps);
    expect(s[0]).toBe(pts[0]);
    expect(s[s.length - 1]).toBe(pts[pts.length - 1]);
    expect(s.length).toBeLessThan(pts.length / 2);
    for (const p of pts) {
      let best = Infinity;
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1] as InkPoint, b = s[i] as InkPoint;
        best = Math.min(best, distToSegment(p.x, p.y, a.x, a.y, b.x, b.y));
      }
      expect(best).toBeLessThanOrEqual(eps + 1e-9);
    }
  });
  it('collapses a straight line to its two ends', () => {
    expect(simplify(line(100))).toHaveLength(2);
  });
  it('returns short inputs unchanged', () => {
    expect(simplify(line(2))).toHaveLength(2);
  });
});

describe('§4 outline', () => {
  it('outlines a straight constant-pressure stroke as a simple capsule of the right area', () => {
    const pts = line(11, 10).map((p) => ({ ...p, p: 2 / 3 })); // length 100, factor 1
    const poly = strokeOutline(pts, 8);
    expect(isSimple(poly)).toBe(true);
    // Capsule: rectangle 100 x 8 plus a circle of radius 4 (polygon approximation is slightly smaller).
    const expected = 100 * 8 + Math.PI * 16;
    expect(Math.abs(area(poly))).toBeGreaterThan(expected * 0.97);
    expect(Math.abs(area(poly))).toBeLessThan(expected * 1.001);
  });

  it('caps both ends on the outside (polygon stays simple for a diagonal stroke)', () => {
    const poly = strokeOutline(line(6, 7, 3).map((p) => ({ ...p, p: 0.5 })), 6);
    expect(isSimple(poly)).toBe(true);
  });

  it('turns a single point into a dot and handles repeated points', () => {
    expect(strokeOutline([{ x: 5, y: 5 }], 4)).toHaveLength(12);
    const poly = strokeOutline([{ x: 0, y: 0, p: 0.5 }, { x: 0, y: 0, p: 0.5 }, { x: 10, y: 0, p: 0.5 }], 4);
    expect(poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('detects constant-width strokes', () => {
    expect(isConstantWidth(line(3))).toBe(true);
    expect(isConstantWidth([{ x: 0, y: 0, p: 0.3 }])).toBe(false);
  });
});

describe('§7 eraser hit tests', () => {
  it('§7.1 point-to-segment distance, including the clamped ends', () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBe(5);
    expect(distToSegment(1, 1, 0, 0, 0, 0)).toBeCloseTo(Math.SQRT2);
  });
  it('§7.2 touches a stroke within radius + half width', () => {
    const pts = line(11, 10);
    expect(strokeTouchesCircle(pts, 2, 50, 7, 5)).toBe(true);
    expect(strokeTouchesCircle(pts, 2, 50, 7.5, 5)).toBe(false);
  });
  it('§7.3 segment/circle interval', () => {
    const iv = segmentCircleInterval(0, 0, 10, 0, 5, 0, 2);
    expect(iv?.[0]).toBeCloseTo(0.3);
    expect(iv?.[1]).toBeCloseTo(0.7);
    expect(segmentCircleInterval(0, 0, 10, 0, 5, 5, 2)).toBeNull();
  });
  it('§7.4 splits a stroke in two where the eraser crosses its middle', () => {
    const pieces = erasePartial(line(11, 10), 0, 50, 0, 10);
    expect(pieces).toHaveLength(2);
    const [a, b] = pieces as InkPoint[][];
    expect(a?.[a.length - 1]?.x).toBeCloseTo(40);
    expect(b?.[0]?.x).toBeCloseTo(60);
    expect(polylineLength(a as InkPoint[]) + polylineLength(b as InkPoint[])).toBeCloseTo(80);
  });
  it('§7.4 erases an end, everything, or nothing', () => {
    expect(erasePartial(line(11, 10), 0, 0, 0, 25)).toHaveLength(1);
    expect(erasePartial(line(11, 10), 0, 50, 0, 100)).toEqual([]);
    expect(erasePartial(line(11, 10), 0, 50, 50, 5)).toBeNull();
  });
  it('§7.4 interpolates pressure at the cut', () => {
    const pts = [{ x: 0, y: 0, p: 0 }, { x: 10, y: 0, p: 1 }];
    const pieces = erasePartial(pts, 0, 10, 0, 5, 0) as InkPoint[][];
    expect(pieces[0]?.[1]?.p).toBeCloseTo(0.5);
  });
});

describe('§8 lasso', () => {
  // A "C" shape: concave, opening to the right.
  const C: InkPoint[] = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 0, y: 30 }];
  it('§8.1 handles concave polygons', () => {
    expect(pointInPolygon(5, 15, C)).toBe(true);
    expect(pointInPolygon(20, 15, C)).toBe(false); // inside the C's mouth
    expect(pointInPolygon(20, 5, C)).toBe(true);
  });
  it('§8.2 selects a stroke when at least half its points are inside', () => {
    expect(strokeInLasso([{ x: 2, y: 2 }, { x: 4, y: 4 }, { x: 50, y: 50 }], C)).toBe(true);
    expect(strokeInLasso([{ x: 2, y: 2 }, { x: 50, y: 50 }, { x: 60, y: 60 }], C)).toBe(false);
    expect(strokeInLasso([{ x: 2, y: 2 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe('svg path output (security: fixed alphabet)', () => {
  it('formats numbers with one decimal, no exponent, NaN or Infinity', () => {
    expect(fmt(1.26)).toBe('1.3');
    expect(fmt(-0.01)).toBe('0');
    expect(fmt(NaN)).toBe('0');
    expect(fmt(Infinity)).toBe('0');
    expect(fmt(1e30)).toBe('1000000');
    expect(fmt(1e-12)).toBe('0');
  });
  it('produces only path characters for any input, including hostile numbers', () => {
    const r = rng(5);
    const weird = [NaN, Infinity, -Infinity, 1e300, -1e-300, 5e-7];
    for (let k = 0; k < 200; k++) {
      const pts = Array.from({ length: 1 + Math.floor(r() * 20) }, () => ({
        x: r() < 0.1 ? (weird[Math.floor(r() * weird.length)] as number) : (r() - 0.5) * 2000,
        y: (r() - 0.5) * 2000,
        p: r(),
      }));
      expect(centerlinePath(pts)).toMatch(SAFE_PATH);
      expect(polygonPath(strokeOutline(pts, 3))).toMatch(SAFE_PATH);
    }
  });
  it('draws dots and two-point lines', () => {
    expect(centerlinePath([{ x: 1, y: 2 }])).toBe('M1 2L1 2');
    expect(centerlinePath([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M1 2L3 4');
    expect(centerlinePath([])).toBe('');
    expect(polygonPath([{ x: 0, y: 0 }])).toBe('');
  });
  it('joins three or more points with quadratic curves through midpoints', () => {
    expect(centerlinePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe('M0 0Q10 0 10 5L10 10');
  });
});
