/**
 * Ink performance counters. Mutated on the UI thread (worklets), read by
 * the JS thread for display. Frame intervals go into a 1 ms histogram.
 *
 * What these numbers can and cannot tell you:
 * - frame intervals: smoothness while drawing (dropped frames)
 * - pointsPerSecond: how often the OS delivers pen samples
 * - true touch-to-ink latency needs a slow-motion video (see TESTING_ON_DEVICE.md)
 */
export const HIST_BUCKETS = 101; // 0..99 ms, 100 = 100+ ms

export interface InkStats {
  strokes: number;
  points: number;
  strokeMs: number;
  stylusStrokes: number;
  touchStrokes: number;
  rejected: number;
  pressureMin: number;
  pressureMax: number;
  frames: number;
  frameMsSum: number;
  frameMsMax: number;
  hist: number[];
}

export function emptyInkStats(): InkStats {
  'worklet';
  const hist: number[] = [];
  for (let i = 0; i < HIST_BUCKETS; i++) hist.push(0);
  return {
    strokes: 0, points: 0, strokeMs: 0, stylusStrokes: 0, touchStrokes: 0, rejected: 0,
    pressureMin: 1, pressureMax: 0, frames: 0, frameMsSum: 0, frameMsMax: 0, hist,
  };
}

export function recordFrame(s: InkStats, intervalMs: number): void {
  'worklet';
  if (!(intervalMs > 0) || intervalMs > 1000) return; // first frame / app paused
  s.frames += 1;
  s.frameMsSum += intervalMs;
  if (intervalMs > s.frameMsMax) s.frameMsMax = intervalMs;
  const b = Math.min(HIST_BUCKETS - 1, Math.floor(intervalMs));
  s.hist[b] = (s.hist[b] ?? 0) + 1;
}

export function recordPressure(s: InkStats, p: number): void {
  'worklet';
  if (!(p > 0)) return;
  if (p < s.pressureMin) s.pressureMin = p;
  if (p > s.pressureMax) s.pressureMax = p;
}

export function histPercentile(hist: readonly number[], p: number): number {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return NaN;
  const target = (p / 100) * total;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i] as number;
    if (acc >= target) return i + 0.5;
  }
  return hist.length - 1;
}

export interface InkSummary {
  strokes: number;
  stylusStrokes: number;
  touchStrokes: number;
  rejectedTouches: number;
  pointsPerSecond: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameMaxMs: number;
  /** Share of frames longer than 1.5x the median frame (a dropped frame). */
  droppedFramePct: number;
  pressureRange: string;
}

export function summarizeInk(s: InkStats): InkSummary {
  const p50 = histPercentile(s.hist, 50);
  const p95 = histPercentile(s.hist, 95);
  let dropped = 0;
  if (Number.isFinite(p50)) {
    const limit = Math.floor(p50 * 1.5);
    for (let i = limit + 1; i < s.hist.length; i++) dropped += s.hist[i] as number;
  }
  return {
    strokes: s.strokes,
    stylusStrokes: s.stylusStrokes,
    touchStrokes: s.touchStrokes,
    rejectedTouches: s.rejected,
    pointsPerSecond: s.strokeMs > 0 ? Math.round((s.points / s.strokeMs) * 1000) : 0,
    frameP50Ms: Math.round(p50 * 10) / 10,
    frameP95Ms: Math.round(p95 * 10) / 10,
    frameMaxMs: Math.round(s.frameMsMax),
    droppedFramePct: s.frames > 0 ? Math.round((dropped / s.frames) * 1000) / 10 : 0,
    pressureRange: s.pressureMax > 0 ? `${s.pressureMin.toFixed(2)}–${s.pressureMax.toFixed(2)}` : 'n/a',
  };
}

/** Pass if drawing is smooth: p95 frame <= 1.5x median and < 5% dropped frames. */
export function judgeInk(s: InkSummary): 'pass' | 'fail' | 'info' {
  if (s.strokes < 10) return 'info';
  return s.frameP95Ms <= s.frameP50Ms * 1.5 + 1 && s.droppedFramePct < 5 ? 'pass' : 'fail';
}
