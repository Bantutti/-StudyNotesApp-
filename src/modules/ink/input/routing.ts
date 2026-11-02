/**
 * Stylus-aware input routing (decision Q8). Decides, for each new pointer,
 * whether it DRAWS, SCROLLS the page, or is IGNORED (a resting palm).
 * Runs on the UI thread (worklet), so it must stay a pure function.
 *
 * Modes (Settings > Ink input; default 'auto'):
 *  - auto:   a finger draws until a stylus has been seen on this device
 *            (remembered in kv); after that the pen draws and one finger
 *            scrolls, with no mode switching.
 *  - stylus: only the pen draws; one finger always scrolls.
 *  - finger: every pointer draws (two fingers still scroll and pinch).
 * The toolbar's "Draw with finger" toggle forces finger drawing in any mode.
 *
 * Palm guards (all thresholds UNVERIFIED on real hardware; the hidden Ink
 * diagnostics screen counts accidental marks and scrolls so Rey's device test
 * can tune them):
 *  - while the pen is down, and for PALM_AFTER_PEN_MS after it lifts, every
 *    touch is ignored (the side of the hand lands while writing);
 *  - if the pen lands within PEN_CANCEL_WINDOW_MS after a touch started, that
 *    touch was a palm: its stroke or scroll is cancelled and undone;
 *  - a one-finger scroll only starts after SCROLL_SLOP_PX of movement.
 * Two-finger pans and pinches are handled by a separate gesture and always
 * scroll/zoom, in every mode.
 */
import { POINTER } from '../policy';

export type InkInputMode = 'auto' | 'stylus' | 'finger';
export type Route = 'draw' | 'scroll' | 'ignore';

export const PALM_AFTER_PEN_MS = 400;
export const PEN_CANCEL_WINDOW_MS = 150;
export const SCROLL_SLOP_PX = 10;

export interface RouteState {
  mode: InkInputMode;
  /** Toolbar toggle "Draw with finger". */
  fingerDraw: boolean;
  /** A stylus has been seen on this device (persisted). */
  stylusSeen: boolean;
  /** A pen is touching the screen right now. */
  penDown: boolean;
  /** When the pen last lifted (ms, same clock as `now`); 0 = never. */
  penUpAt: number;
  now: number;
}

/** Route for a pointer that just went down. */
export function routePointer(pointerType: number, s: RouteState): Route {
  'worklet';
  if (pointerType === POINTER.STYLUS || pointerType === POINTER.MOUSE) return 'draw';
  // Touch from here on.
  if (s.penDown) return 'ignore';
  if (s.penUpAt > 0 && s.now - s.penUpAt < PALM_AFTER_PEN_MS) return 'ignore';
  if (s.fingerDraw || s.mode === 'finger') return 'draw';
  if (s.mode === 'stylus') return 'scroll';
  return s.stylusSeen ? 'scroll' : 'draw';
}

/**
 * True when a touch that started at `touchStartAt` should be cancelled
 * because a pen landed at `penDownAt` right after it (a palm, not a finger).
 */
export function penCancelsTouch(touchStartAt: number, penDownAt: number): boolean {
  'worklet';
  const dt = penDownAt - touchStartAt;
  return dt >= 0 && dt <= PEN_CANCEL_WINDOW_MS;
}

/** True once a one-finger scroll has moved far enough to really be a scroll. */
export function pastScrollSlop(dx: number, dy: number): boolean {
  'worklet';
  return dx * dx + dy * dy >= SCROLL_SLOP_PX * SCROLL_SLOP_PX;
}
