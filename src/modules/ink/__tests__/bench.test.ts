import { judgeBench, runInkBench, syntheticLayout } from '../diagnostics/bench';

describe('ink engine bench (synthetic data, for the diagnostics screen)', () => {
  it('builds a labelled synthetic layer and reports timings and sizes only', () => {
    const b = runInkBench({ strokes: 300 });
    expect(b.synthetic).toBe(true);
    expect(b.strokes).toBe(300);
    expect(b.points).toBeGreaterThan(300);
    expect(b.fileBytes).toBeGreaterThan(0);
    for (const k of ['buildMs', 'serializeMs', 'parseMs', 'renderMs', 'eraseHitMs', 'lassoMs', 'mergeMs'] as const) {
      expect(Number.isFinite(b[k])).toBe(true);
      expect(b[k]).toBeGreaterThanOrEqual(0);
    }
    expect(Object.keys(b).every((k) => !['d', 'o', 'strokes_data'].includes(k))).toBe(true);
  });

  it('judges against the targets', () => {
    const fast = { synthetic: true as const, strokes: 1, points: 1, fileBytes: 1, buildMs: 0, serializeMs: 0, parseMs: 1, renderMs: 1, eraseHitMs: 1, lassoMs: 1, mergeMs: 0 };
    expect(judgeBench(fast)).toBe('pass');
    expect(judgeBench({ ...fast, eraseHitMs: 99 })).toBe('fail');
  });

  it('uses a fixed fake page', () => {
    expect(syntheticLayout(3).blocks.map((b) => b.top)).toEqual([20, 54, 88]);
  });

  it('a full 5,000-stroke layer stays under the file cap', () => {
    const b = runInkBench({ strokes: 5_000 });
    expect(b.strokes).toBe(5_000);
    expect(b.fileBytes).toBeLessThan(4 * 1024 * 1024);
  });
});
