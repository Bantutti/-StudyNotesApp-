import { chunkInkItems, INK_MAX_PATH_CHARS, INK_PATH_CHARS, toWebSchema } from '@/modules/editor';

import { SAFE_PATH } from '../geometry/svg';
import { renderDiff, renderLayer, renderStroke } from '../render';
import { INK_LIMITS } from '../model/limits';
import { layerWith, rng, stroke } from './helpers';

const valid = (items: unknown[]) => toWebSchema.safeParse({ v: 1, type: 'inkAdd', items }).success;

describe('ink render items (native -> editor page)', () => {
  it('uses exactly the bridge path alphabet', () => {
    expect(SAFE_PATH.source).toBe(INK_PATH_CHARS.source);
  });

  it('draws the highlighter under the text as a constant-width line', () => {
    const it = renderStroke(stroke({ tool: 'hl', c: 'h0', w: 140 }));
    expect(it).toMatchObject({ layer: 'under', mode: 'stroke', w: 14, c: 'h0' });
    expect(valid([it])).toBe(true);
  });

  it('draws a pen without pressure as a line, and with pressure as a filled outline over the text', () => {
    expect(renderStroke(stroke())).toMatchObject({ layer: 'over', mode: 'stroke', w: 3 });
    const p = renderStroke(stroke({ p: [10, 50, 90, 40] }));
    expect(p).toMatchObject({ layer: 'over', mode: 'fill' });
    expect(p.d.endsWith('Z')).toBe(true);
    expect(valid([p])).toBe(true);
  });

  it('caches one item per stroke object (strokes are immutable)', () => {
    const s = stroke();
    expect(renderStroke(s)).toBe(renderStroke(s));
  });

  it('keeps the largest allowed stroke under the bridge path cap', () => {
    // 2,000 points of zig-zag with pressure at the far edge of the coordinate range: the worst case.
    const r = rng(1);
    const d: number[] = [];
    for (let i = 1; i < INK_LIMITS.maxPointsPerStroke; i++) d.push(i % 2 ? 37 : -37, Math.round((r() - 0.5) * 40));
    const big = stroke({ o: [-999, -49_999], d, p: Array.from({ length: INK_LIMITS.maxPointsPerStroke }, () => Math.floor(r() * 100)), w: 400 });
    const item = renderStroke(big);
    expect(item.d.length).toBeLessThan(INK_MAX_PATH_CHARS);
    expect(valid([item])).toBe(true);
  });

  it('diffs layers by id: removed ids and new items only', () => {
    const a = stroke();
    const b = stroke();
    const c = stroke();
    const diff = renderDiff(layerWith([a, b]), layerWith([b, c]));
    expect(diff.remove).toEqual([a.id]);
    expect(diff.add.map((i) => i.id)).toEqual([c.id]);
    expect(renderDiff(null, layerWith([a])).add).toHaveLength(1);
    expect(renderLayer(layerWith([a, b]))).toHaveLength(2);
  });

  it('chunks big batches under the per-message item and size limits', () => {
    const items = Array.from({ length: 1_234 }, () => renderStroke(stroke()));
    const chunks = chunkInkItems(items);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 234]);
    expect(chunks.every((c) => valid(c))).toBe(true);
    const fat = Array.from({ length: 20 }, () => ({ ...renderStroke(stroke()), d: 'M0 0'.padEnd(150_000, '0') }));
    const fatChunks = chunkInkItems(fat);
    expect(fatChunks.length).toBeGreaterThan(1);
    for (const c of fatChunks) expect(JSON.stringify(c).length).toBeLessThan(1_600_000);
  });

  it('the bridge refuses hostile ink items', () => {
    const ok = renderStroke(stroke());
    expect(valid([ok])).toBe(true);
    for (const bad of [
      { ...ok, d: 'M0 0"/><script>' },
      { ...ok, d: 'M1e9 0' },
      { ...ok, d: 'M0 0'.padEnd(INK_MAX_PATH_CHARS + 1, '0') },
      { ...ok, c: 'red' },
      { ...ok, c: 'url(#x)' },
      { ...ok, c: '#abcdef' },
      { ...ok, layer: 'top' },
      { ...ok, id: 'x' },
      { ...ok, b: 'b_<img>' },
      { ...ok, w: 99 },
      { ...ok, style: 'fill:red' },
    ]) {
      expect(valid([bad])).toBe(false);
    }
    expect(valid(Array.from({ length: 501 }, () => ok))).toBe(false);
  });
});
