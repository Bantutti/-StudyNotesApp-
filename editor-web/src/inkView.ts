/**
 * Draw-mode page movement (P4b). In Draw mode the native overlay owns every
 * touch (so a pen never selects text), which means the page can't scroll
 * itself. Native sends what the fingers did:
 *  - inkScroll: move by (dx, dy) CSS px right now;
 *  - inkFling: keep moving with velocity (vx, vy) px/s, slowing down
 *    exponentially (v *= FLING_DECAY per 16 ms frame) until it's < 20 px/s;
 *  - inkZoom: pinch zoom 1x..3x (decision Q11) with CSS zoom on the page
 *    root, so the page really grows: the text keeps its line breaks, and the
 *    page can then scroll sideways as well. Reset to 1 when Draw mode ends.
 * Any new scroll stops a running fling. Values were range-checked by the
 * bridge schema; they are clamped again here.
 */
export const FLING_DECAY = 0.95;
const MIN_FLING = 20;

export interface InkViewDeps {
  root: HTMLElement;
  /** Called after the page moved or zoomed (the ink layer re-measures). */
  onMoved: () => void;
  scrollBy?: (dx: number, dy: number) => void;
  raf?: (fn: (t: number) => void) => number;
  cancelRaf?: (h: number) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createInkView(deps: InkViewDeps) {
  const scrollBy = deps.scrollBy ?? ((dx: number, dy: number) => window.scrollBy(dx, dy));
  const raf = deps.raf ?? ((fn: (t: number) => void) => requestAnimationFrame(fn));
  const cancel = deps.cancelRaf ?? ((h: number) => cancelAnimationFrame(h));
  let fling: number | null = null;
  let zoom = 1;

  const stopFling = () => {
    if (fling !== null) cancel(fling);
    fling = null;
  };

  return {
    scroll(dx: number, dy: number): void {
      stopFling();
      scrollBy(clamp(dx, -20_000, 20_000), clamp(dy, -20_000, 20_000));
      deps.onMoved();
    },
    fling(vx: number, vy: number): void {
      stopFling();
      let x = clamp(vx, -50_000, 50_000);
      let y = clamp(vy, -50_000, 50_000);
      let last = -1;
      const step = (t: number) => {
        const dt = last < 0 ? 16 : Math.min(64, t - last);
        last = t;
        scrollBy((x * dt) / 1000, (y * dt) / 1000);
        deps.onMoved();
        const k = Math.pow(FLING_DECAY, dt / 16);
        x *= k;
        y *= k;
        fling = Math.hypot(x, y) < MIN_FLING ? null : raf(step);
      };
      if (Math.hypot(x, y) >= MIN_FLING) fling = raf(step);
    },
    zoom(scale: number): void {
      const s = clamp(scale, 1, 3);
      if (s === zoom) return;
      zoom = s;
      // template.html: #root{zoom:var(--ink-zoom,1)}
      if (s === 1) deps.root.style.removeProperty('--ink-zoom');
      else deps.root.style.setProperty('--ink-zoom', String(Math.round(s * 100) / 100));
      deps.onMoved();
    },
    get zoomLevel() {
      return zoom;
    },
    stop: stopFling,
  };
}
