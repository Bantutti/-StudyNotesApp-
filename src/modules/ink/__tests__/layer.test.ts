import { serializeInk } from '../model/format';
import { createInkHistory } from '../model/history';
import { applyOp, compactTombstones, detachedStrokes, estimateLayerBytes, inverseOp, purgeUnrecoverable } from '../model/layer';
import { INK_LIMITS } from '../model/limits';
import { mergeInkLayers } from '../model/merge';
import { B1, B2, NOTE, ctx, layerWith, rng, stroke } from './helpers';

describe('layer.applyOp', () => {
  it('adds and removes as one step, tombstoning removed ids, without mutating the input', () => {
    const c = ctx();
    const a = stroke();
    const b = stroke();
    const l0 = layerWith([a]);
    const r = applyOp(l0, { remove: [a], add: [b] }, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layer.strokes.map((s) => s.id)).toEqual([b.id]);
    expect(r.layer.gone.map((g) => g.id)).toEqual([a.id]);
    expect(l0.strokes).toEqual([a]); // input untouched
  });

  it('gives a fresh id to a re-added stroke whose id is dead (strokes are immutable)', () => {
    const c = ctx();
    const a = stroke();
    const removed = applyOp(layerWith([a]), { remove: [a], add: [] }, c);
    if (!removed.ok) throw new Error('setup');
    const back = applyOp(removed.layer, { remove: [], add: [a] }, c);
    if (!back.ok) throw new Error('re-add');
    expect(back.layer.strokes).toHaveLength(1);
    expect(back.layer.strokes[0]?.id).not.toBe(a.id);
    expect(back.idMap.get(a.id)).toBe(back.layer.strokes[0]?.id);
    expect(back.layer.strokes[0]?.d).toEqual(a.d);
  });

  it('refuses an op that would pass the stroke cap, leaving the layer untouched', () => {
    const many = Array.from({ length: INK_LIMITS.maxStrokes }, (_, i) => stroke({ id: `s_F${String(i).padStart(15, '0')}`, d: [] }));
    const r = applyOp(layerWith(many), { remove: [], add: [stroke()] }, ctx());
    expect(r).toEqual({ ok: false, reason: 'full' });
  });

  it('estimates the serialized size exactly for a layer without tombstones', () => {
    const l = layerWith([stroke(), stroke({ p: [1, 2, 3, 4] })]);
    const exact = serializeInk(l).length;
    const est = estimateLayerBytes(l.strokes, 0);
    expect(est).toBeGreaterThanOrEqual(exact);
    expect(est - exact).toBeLessThan(250);
  });

  it('compacts tombstones oldest-first, deterministically', () => {
    const gone = [3, 1, 2, 5, 4].map((t) => ({ id: `s_G${String(t).padStart(15, '0')}`, t }));
    expect(compactTombstones(gone, 3).map((g) => g.t)).toEqual([5, 4, 3]);
  });

  it('finds detached strokes and purges only unrecoverable ones', () => {
    const c = ctx();
    const a = stroke({ b: B1 });
    const b = stroke({ b: B2 });
    const l = layerWith([a, b]);
    expect(detachedStrokes(l, new Set([B1]))).toEqual([b]);
    // B2 is still in a saved version -> kept; once it isn't -> purged with a tombstone.
    expect(purgeUnrecoverable(l, new Set([B1, B2]), c)).toBe(l);
    const purged = purgeUnrecoverable(l, new Set([B1]), c);
    expect(purged.strokes).toEqual([a]);
    expect(purged.gone.map((g) => g.id)).toEqual([b.id]);
  });
});

describe('history (undo / redo, decision Q5)', () => {
  it('undoes and redoes add, erase and move steps exactly', () => {
    const c = ctx();
    const h = createInkHistory();
    let layer = layerWith([]);
    const step = (op: Parameters<typeof applyOp>[1]) => {
      const r = applyOp(layer, op, c);
      if (!r.ok) throw new Error('full');
      layer = r.layer;
      h.push(r.applied);
    };
    const undo = () => {
      const op = h.peekUndo();
      if (!op) return;
      const r = applyOp(layer, op, c);
      if (!r.ok) throw new Error('full');
      layer = r.layer;
      h.remap(r.idMap);
      h.commitUndo(r.applied);
    };
    const redo = () => {
      const op = h.peekRedo();
      if (!op) return;
      const r = applyOp(layer, op, c);
      if (!r.ok) throw new Error('full');
      layer = r.layer;
      h.remap(r.idMap);
      h.commitRedo(r.applied);
    };
    const shape = () => layer.strokes.map((s) => JSON.stringify([s.b, s.o, s.d, s.c])).sort();

    const a = stroke();
    const b = stroke({ o: [300, 40] });
    step({ remove: [], add: [a] });
    step({ remove: [], add: [b] });
    const s2 = shape();
    const moved = { ...b, id: c.newStrokeId(), o: [310, 45] as [number, number] };
    step({ remove: [b], add: [moved] }); // a lasso move
    const s3 = shape();
    step({ remove: [a], add: [] }); // erase a
    expect(layer.strokes).toHaveLength(1);

    undo(); // un-erase a (with a fresh id)
    expect(shape()).toEqual(s3);
    undo(); // un-move b
    expect(shape()).toEqual(s2);
    redo(); // move again
    expect(shape()).toEqual(s3);
    undo();
    undo();
    undo();
    expect(layer.strokes).toEqual([]);
    expect(h.canUndo).toBe(false);
    redo();
    redo();
    expect(shape()).toEqual(s2);
  });

  it('keeps at most maxHistory steps and a new action clears redo', () => {
    const h = createInkHistory(3);
    for (let i = 0; i < 5; i++) h.push({ remove: [], add: [stroke()] });
    expect(h.size).toBe(3);
    const op = h.peekUndo();
    if (op) h.commitUndo(op);
    expect(h.canRedo).toBe(true);
    h.push({ remove: [], add: [stroke()] });
    expect(h.canRedo).toBe(false);
    h.push({ remove: [], add: [] }); // empty ops are ignored
    expect(h.size).toBe(3);
  });

  it('inverseOp swaps add and remove', () => {
    const a = stroke();
    expect(inverseOp({ remove: [], add: [a] })).toEqual({ remove: [a], add: [] });
  });
});

describe('merge (decision Q10, INK_MATH §10)', () => {
  /** Random replica: a subset of a shared pool of strokes, some deleted. */
  function replica(seed: number, pool: ReturnType<typeof stroke>[]) {
    const r = rng(seed);
    const live = pool.filter(() => r() < 0.6);
    const gone = pool.filter((s) => !live.includes(s) && r() < 0.5).map((s) => ({ id: s.id, t: Math.floor(r() * 1000) }));
    return layerWith(live.filter((s) => !gone.some((g) => g.id === s.id)), gone);
  }
  const m = (a: ReturnType<typeof layerWith>, b: ReturnType<typeof layerWith>) => {
    const r = mergeInkLayers(a, b);
    if (!r.ok) throw new Error('merge failed');
    return r.value;
  };
  const key = (l: ReturnType<typeof layerWith>) => serializeInk(l);

  it('is commutative, associative and idempotent (seeded property test)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const pool = Array.from({ length: 12 }, () => stroke());
      const a = replica(seed, pool);
      const b = replica(seed * 31, pool);
      const c = replica(seed * 977, pool);
      expect(key(m(a, b))).toBe(key(m(b, a)));
      expect(key(m(m(a, b), c))).toBe(key(m(a, m(b, c))));
      expect(key(m(a, a))).toBe(key(m(a, layerWith([]))));
      expect(key(m(m(a, b), b))).toBe(key(m(a, b)));
    }
  });

  it('a tombstone always beats a live copy', () => {
    const s = stroke();
    const merged = m(layerWith([s]), layerWith([], [{ id: s.id, t: 1 }]));
    expect(merged.strokes).toEqual([]);
    expect(merged.gone.map((g) => g.id)).toEqual([s.id]);
  });

  it('keeps strokes drawn on both devices (nothing is lost)', () => {
    const a = stroke();
    const b = stroke();
    expect(m(layerWith([a]), layerWith([b])).strokes.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('refuses to merge layers of different notes', () => {
    const other = { ...layerWith([]), note: 'n_0000000000000009' };
    expect(mergeInkLayers(layerWith([]), other).ok).toBe(false);
    expect(layerWith([]).note).toBe(NOTE);
  });
});
