import { acceptPointer, POINTER } from '../policy';
import { emptyInkStats, histPercentile, judgeInk, recordFrame, recordPressure, summarizeInk } from '../stats';

describe('palm rejection policy', () => {
  it.each([
    ['any', POINTER.TOUCH, true, true],
    ['auto', POINTER.TOUCH, false, true],
    ['auto', POINTER.TOUCH, true, false],
    ['stylus', POINTER.TOUCH, false, false],
    ['stylus', POINTER.STYLUS, false, true],
    ['auto', POINTER.MOUSE, true, true],
  ] as const)('mode %s pointer %i stylusSeen %s -> %s', (mode, ptr, seen, expected) => {
    expect(acceptPointer(mode, ptr, seen)).toBe(expected);
  });
});

describe('ink stats', () => {
  it('builds a frame histogram and percentiles', () => {
    const s = emptyInkStats();
    for (let i = 0; i < 95; i++) recordFrame(s, 16.6);
    for (let i = 0; i < 5; i++) recordFrame(s, 40);
    recordFrame(s, 0); // ignored
    recordFrame(s, 5000); // ignored (app paused)
    expect(s.frames).toBe(100);
    expect(histPercentile(s.hist, 50)).toBe(16.5);
    expect(histPercentile(s.hist, 99)).toBe(40.5);
    const sum = summarizeInk({ ...s, strokes: 12, points: 1200, strokeMs: 10_000 });
    expect(sum.pointsPerSecond).toBe(120);
    expect(sum.droppedFramePct).toBe(5);
    expect(judgeInk(sum)).toBe('fail');
  });
  it('tracks the stylus pressure range', () => {
    const s = emptyInkStats();
    recordPressure(s, 0.2);
    recordPressure(s, 0.9);
    recordPressure(s, 0); // finger: no pressure
    expect(summarizeInk(s).pressureRange).toBe('0.20–0.90');
  });
  it('needs at least 10 strokes for a verdict', () => {
    expect(judgeInk(summarizeInk(emptyInkStats()))).toBe('info');
  });
});
