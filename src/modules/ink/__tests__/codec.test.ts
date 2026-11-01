import { decodePoints, encodePoints, pxToUnits, strokeBounds, strokePoints, unitsToPx } from '../model/codec';
import { checkStroke } from '../model/format';
import { INK_LIMITS } from '../model/limits';
import { rng, stroke } from './helpers';

const box = { left: 24, top: 300, width: 350, height: 40 };

describe('§1.2 px <-> units', () => {
  it('maps the block top-left to (0, 0) and the right edge to x = 1000', () => {
    expect(pxToUnits({ x: 24, y: 300 }, box)).toEqual({ x: 0, y: 0 });
    expect(pxToUnits({ x: 374, y: 300 }, box).x).toBeCloseTo(1000);
  });
  it('uses the same scale on x and y (shape preserved)', () => {
    const u = pxToUnits({ x: 24 + 35, y: 300 + 35 }, box);
    expect(u.x).toBeCloseTo(u.y);
  });
  it('unitsToPx inverts pxToUnits and keeps pressure', () => {
    const p = { x: 111.3, y: 444.4, p: 0.4 };
    const back = unitsToPx(pxToUnits(p, box), box);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
    expect(back.p).toBe(0.4);
  });
  it('never divides by zero for a zero-width box', () => {
    const u = pxToUnits({ x: 10, y: 10 }, { left: 0, top: 0, width: 0, height: 0 });
    expect(Number.isFinite(u.x)).toBe(true);
  });
});

describe('§6 encode / decode', () => {
  it('quantises with at most 0.5 units of error and no drift along the stroke', () => {
    const r = rng(7);
    const pts = Array.from({ length: 500 }, (_, i) => ({ x: 100 + i * 0.73 + r() * 0.2, y: 50 + Math.sin(i / 9) * 40 }));
    const enc = encodePoints(pts);
    const flat = decodePoints(enc);
    // Duplicates may be dropped, so compare each decoded point to the nearest input.
    for (let i = 0; i < flat.length; i += 2) {
      const x = flat[i] as number;
      const y = flat[i + 1] as number;
      const best = Math.min(...pts.map((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y))));
      expect(best).toBeLessThanOrEqual(0.5);
    }
    // Last point: exact rounding of the last input (no accumulated error).
    expect(flat[flat.length - 2]).toBe(Math.round((pts[pts.length - 1] as { x: number }).x));
  });

  it('drops consecutive duplicates after rounding', () => {
    const enc = encodePoints([{ x: 1, y: 1 }, { x: 1.2, y: 0.9 }, { x: 5, y: 5 }]);
    expect(enc.d).toEqual([4, 4]);
  });

  it('subdivides steps longer than maxStep so the stroke stays valid', () => {
    const enc = encodePoints([{ x: 0, y: 0 }, { x: 0, y: 9_500 }]);
    expect(enc.d.length).toBe(6); // 3 steps
    expect(Math.max(...enc.d.map(Math.abs))).toBeLessThanOrEqual(INK_LIMITS.maxStep);
    expect(decodePoints(enc).slice(-2)).toEqual([0, 9_500]);
    expect(checkStroke(stroke({ o: enc.o, d: enc.d }))).toBeNull();
  });

  it('clamps coordinates into the stored range and never emits NaN', () => {
    const enc = encodePoints([{ x: NaN, y: Infinity }, { x: 1e9, y: -1e9 }]);
    expect(enc.o).toEqual([0, 0]);
    const flat = decodePoints(enc);
    expect(flat.every(Number.isFinite)).toBe(true);
    expect(checkStroke(stroke({ o: enc.o, d: enc.d }))).toBeNull();
  });

  it('keeps one pressure value per point, as integers 0..100', () => {
    const enc = encodePoints([{ x: 0, y: 0, p: 0.25 }, { x: 3, y: 0, p: 2 }, { x: 6, y: 0 }]);
    expect(enc.p).toEqual([25, 100, 0]);
    expect(strokePoints(enc)[0]?.p).toBe(0.25);
  });

  it('computes stroke bounds', () => {
    expect(strokeBounds({ o: [5, 5], d: [10, -2, -20, 7] })).toEqual([-5, 3, 15, 10]);
  });
});
