/**
 * Ink engine bench for the hidden Ink diagnostics screen (P4b M9).
 *
 * SYNTHETIC DATA: the layer is generated (wavy handwriting-like strokes over
 * a fake page layout), not anyone's notes. The screen labels it as such.
 * It measures what the device test needs numbers for, on the device's own
 * JS engine (Hermes):
 *   - build: raw samples -> stored strokes (smooth, simplify, encode),
 *   - serialize / parse+validate the whole file, and its size,
 *   - render: strokes -> SVG path items for the page,
 *   - eraser and lasso hit tests over the full layer,
 *   - merge of two copies.
 * Results are timings and counts only, never stroke data.
 */
import { createInkController, type InkViewLayout } from '../controller';
import { buildStrokes } from '../model/build';
import { emptyInkLayer, parseInkJson, serializeInk, type InkLayer, type InkStroke } from '../model/format';
import { applyOp } from '../model/layer';
import { mergeInkLayers } from '../model/merge';
import { renderLayer } from '../render';

export interface BenchResult {
  /** Always true: these numbers come from generated strokes, not real notes. */
  synthetic: true;
  strokes: number;
  points: number;
  fileBytes: number;
  buildMs: number;
  serializeMs: number;
  parseMs: number;
  renderMs: number;
  eraseHitMs: number;
  lassoMs: number;
  mergeMs: number;
}

/** Deterministic PRNG (so runs on different phones use the same strokes). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fake page: `blocks` paragraphs of 30 px, 360 px wide. */
export function syntheticLayout(blocks = 200): InkViewLayout {
  return {
    originX: 0,
    originY: 0,
    pageWidth: 400,
    blocks: Array.from({ length: blocks }, (_, i) => ({ id: `b_BENCH${String(i).padStart(8, '0')}`, depth: 0, left: 20, top: 20 + i * 34, width: 360, height: 30 })),
  };
}

const ms = (now: () => number, f: () => void): number => {
  const t = now();
  f();
  return Math.round((now() - t) * 10) / 10;
};

export function runInkBench(opts: { strokes?: number; now?: () => number; noteId?: string } = {}): BenchResult {
  const n = opts.strokes ?? 5_000;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const note = opts.noteId ?? 'n_bench00000000001';
  const layout = syntheticLayout(200);
  const r = prng(7);
  let seq = 0;
  const newStrokeId = () => `s_BENCH${String(++seq).padStart(11, '0')}`;

  // build
  let built: InkStroke[] = [];
  const buildMs = ms(now, () => {
    for (let k = 0; k < n; k++) {
      const box = layout.blocks[k % layout.blocks.length] as InkViewLayout['blocks'][number];
      const x0 = box.left + r() * 250;
      const y0 = box.top + 8 + r() * 14;
      const raw = Array.from({ length: 24 }, (_, i) => ({ x: x0 + i * 3, y: y0 + Math.sin(i / 3 + k) * 5 + r(), p: 0.4 + r() * 0.4 }));
      built = built.concat(buildStrokes({ raw, anchor: box.id, box, tool: 'pen', color: 'p0', widthPx: 3, now: 1_760_000_000_000 + k, newStrokeId }));
    }
  });
  const res = applyOp(emptyInkLayer(note), { remove: [], add: built }, { newStrokeId, now: () => 1_760_000_000_000 });
  const layer: InkLayer = res.ok ? res.layer : emptyInkLayer(note);
  const points = layer.strokes.reduce((a, s) => a + 1 + s.d.length / 2, 0);

  let text = '';
  const serializeMs = ms(now, () => {
    text = serializeInk(layer);
  });
  const parseMs = ms(now, () => {
    parseInkJson(text, { expectedNote: note });
  });
  const renderMs = ms(now, () => {
    renderLayer(layer);
  });

  const ctl = createInkController(layer, { newStrokeId, now: () => 1, onChange: () => undefined });
  ctl.setLayout(layout);
  const eraseHitMs = ms(now, () => {
    ctl.beginErase();
    ctl.eraseAt(390, 5); // a miss: scans the whole layer, changes nothing
    ctl.endErase();
  });
  const lassoMs = ms(now, () => {
    ctl.lassoSelect([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]);
  });
  const half = { ...layer, strokes: layer.strokes.slice(0, Math.floor(layer.strokes.length / 2)) };
  const mergeMs = ms(now, () => {
    mergeInkLayers(layer, half);
  });

  return { synthetic: true, strokes: layer.strokes.length, points, fileBytes: text.length, buildMs, serializeMs, parseMs, renderMs, eraseHitMs, lassoMs, mergeMs };
}

/** Pass thresholds for the device test (UNVERIFIED targets; tune with Rey's numbers). */
export const BENCH_TARGETS = { parseMs: 300, renderMs: 400, eraseHitMs: 16, lassoMs: 100 } as const;

export function judgeBench(b: BenchResult): 'pass' | 'fail' {
  return b.parseMs <= BENCH_TARGETS.parseMs && b.renderMs <= BENCH_TARGETS.renderMs && b.eraseHitMs <= BENCH_TARGETS.eraseHitMs && b.lassoMs <= BENCH_TARGETS.lassoMs
    ? 'pass'
    : 'fail';
}
