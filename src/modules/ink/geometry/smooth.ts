/**
 * Stroke smoothing (docs/modules/INK_MATH.md §2) and pressure -> width (§3).
 *
 * Smoothing is an exponential moving average ("streamline"):
 *   s_0 = r_0,   s_i = s_(i-1) + (1 - k) * (r_i - s_(i-1))        (§2.1)
 * It is INCREMENTAL: s_i depends only on s_(i-1) and the new raw point, so the
 * live overlay (which sees points one at a time on the UI thread) and the
 * committed stroke (which sees them all at once) produce IDENTICAL points.
 * That is why decision Q6 chose our own function over a library: a stroke
 * never visibly jumps when it is committed.
 *
 * The EMA lags behind the pen by about k/(1-k) samples (§2.2), so the stroke
 * ends with the last RAW point (where the pen actually lifted).
 *
 * All functions are worklets: plain math, no closures over JS-thread state.
 */
import type { InkPoint } from '../model/codec';

/** Position smoothing factor k (§2.1): 0 = raw input, closer to 1 = smoother but laggier. */
export const SMOOTHING = 0.5;
/** Pressure smoothing factor (pressure sensors are noisier than positions). */
export const PRESSURE_SMOOTHING = 0.6;

/** §2.1 One smoothing step: the next smoothed point from the previous one and a new raw sample. */
export function smoothStep(prev: InkPoint, raw: InkPoint, k: number = SMOOTHING, kp: number = PRESSURE_SMOOTHING): InkPoint {
  'worklet';
  const x = prev.x + (1 - k) * (raw.x - prev.x);
  const y = prev.y + (1 - k) * (raw.y - prev.y);
  if (raw.p === undefined) return { x, y };
  const pp = prev.p === undefined ? raw.p : prev.p + (1 - kp) * (raw.p - prev.p);
  return { x, y, p: pp };
}

/**
 * §2.1 + §2.2 Smooths a whole raw stroke: EMA over every sample, then the
 * final raw sample appended (if it differs) so the stroke ends under the pen.
 */
export function smoothStroke(raw: readonly InkPoint[], k: number = SMOOTHING): InkPoint[] {
  'worklet';
  if (raw.length === 0) return [];
  const first = raw[0] as InkPoint;
  const out: InkPoint[] = [first];
  let prev = first;
  for (let i = 1; i < raw.length; i++) {
    prev = smoothStep(prev, raw[i] as InkPoint, k);
    out.push(prev);
  }
  const last = raw[raw.length - 1] as InkPoint;
  if (raw.length > 1 && (prev.x !== last.x || prev.y !== last.y)) out.push(last);
  return out;
}

/** §3 width factor range: a light touch draws 40% of the nominal width, a hard press 130%. */
export const PRESSURE_MIN_FACTOR = 0.4;
export const PRESSURE_MAX_FACTOR = 1.3;

/**
 * §3.1 Width multiplier from pressure p in 0..1:
 *   f(p) = clamp(0.4 + 0.9 p, 0.4, 1.3)
 * f(0.667) = 1, so a normal press draws the nominal width. No pressure
 * reported (finger, mouse) -> exactly 1.
 */
export function pressureFactor(p: number | undefined): number {
  'worklet';
  if (p === undefined || !Number.isFinite(p)) return 1;
  const f = 0.4 + 0.9 * p;
  return f < PRESSURE_MIN_FACTOR ? PRESSURE_MIN_FACTOR : f > PRESSURE_MAX_FACTOR ? PRESSURE_MAX_FACTOR : f;
}
