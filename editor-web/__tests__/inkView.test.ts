/**
 * @jest-environment jsdom
 */
import { createInkView, FLING_DECAY } from '../src/inkView';

function setup() {
  const root = document.createElement('div');
  const moves: [number, number][] = [];
  const frames: ((t: number) => void)[] = [];
  let moved = 0;
  const view = createInkView({
    root,
    onMoved: () => moved++,
    scrollBy: (dx, dy) => moves.push([dx, dy]),
    raf: (fn) => frames.push(fn),
    cancelRaf: () => frames.splice(0),
  });
  let t = 0;
  const frame = () => {
    t += 16;
    frames.shift()?.(t);
  };
  return { root, view, moves, frames, frame, moved: () => moved };
}

describe('Draw-mode page movement', () => {
  it('scrolls by the deltas native sends (clamped)', () => {
    const { view, moves, moved } = setup();
    view.scroll(0, 40);
    view.scroll(1e9, -1e9);
    expect(moves).toEqual([[0, 40], [20_000, -20_000]]);
    expect(moved()).toBe(2);
  });

  it('flings with exponential decay and stops when slow', () => {
    const { view, moves, frames, frame } = setup();
    view.fling(0, 1000);
    for (let i = 0; i < 200 && frames.length; i++) frame();
    expect(frames).toHaveLength(0);
    const ys = moves.map((m) => m[1]);
    expect(ys[0]).toBeCloseTo(16, 0);
    expect(ys[1]! / ys[0]!).toBeCloseTo(FLING_DECAY, 2);
    expect(ys.reduce((a, b) => a + b, 0)).toBeLessThan(1000 * 0.016 / (1 - FLING_DECAY) + 1);
  });

  it('a new scroll stops a running fling', () => {
    const { view, frames } = setup();
    view.fling(0, 1000);
    expect(frames).toHaveLength(1);
    view.scroll(0, 1);
    expect(frames).toHaveLength(0);
  });

  it('zooms the page 1x..3x with CSS zoom and resets at 1', () => {
    const { view, root } = setup();
    view.zoom(2);
    expect(root.style.getPropertyValue('--ink-zoom')).toBe('2');
    view.zoom(9);
    expect(view.zoomLevel).toBe(3);
    view.zoom(1);
    expect(root.style.getPropertyValue('--ink-zoom')).toBe('');
  });
});
