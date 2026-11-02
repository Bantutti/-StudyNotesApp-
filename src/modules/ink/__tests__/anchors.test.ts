import type { NoteDoc } from '@/core';

import { POINTER } from '../policy';
import { centreOf, pickAnchor, reexpress, strokeCentrePx, strokeToPx, widthPx, type InkLayout } from '../model/anchors';
import { buildStrokes, splitPoints, widthToTenths } from '../model/build';
import { checkStroke, validateInkLayer } from '../model/format';
import { INK_LIMITS } from '../model/limits';
import { reconcile, scanDoc } from '../model/reconcile';
import { smoothStroke } from '../geometry/smooth';
import { PALM_AFTER_PEN_MS, pastScrollSlop, penCancelsTouch, routePointer, type RouteState } from '../input/routing';
import { B1, B2, B3, ctx, layerWith } from './helpers';

const LAYOUT: InkLayout = {
  pageWidth: 400,
  blocks: [
    { id: B1, depth: 0, left: 20, top: 0, width: 360, height: 40 },
    { id: B2, depth: 0, left: 20, top: 50, width: 360, height: 80 }, // a list
    { id: B3, depth: 1, left: 40, top: 55, width: 340, height: 30 }, // its first item
  ],
};

describe('§9.1 pickAnchor', () => {
  it('picks the deepest block containing the point', () => {
    expect(pickAnchor(LAYOUT, 100, 60)?.id).toBe(B3);
    expect(pickAnchor(LAYOUT, 100, 120)?.id).toBe(B2);
    expect(pickAnchor(LAYOUT, 100, 10)?.id).toBe(B1);
  });
  it('falls back to the nearest top-level block above, then the first block', () => {
    expect(pickAnchor(LAYOUT, 390, 45)?.id).toBe(B1); // right margin between blocks
    expect(pickAnchor(LAYOUT, 100, 999)?.id).toBe(B2); // below the last block
    expect(pickAnchor({ pageWidth: 400, blocks: [{ id: B2, depth: 0, left: 0, top: 100, width: 300, height: 10 }] }, 5, 5)?.id).toBe(B2);
    expect(pickAnchor({ pageWidth: 400, blocks: [] }, 5, 5)).toBeNull();
  });
  it('computes centres', () => {
    expect(centreOf([{ x: 0, y: 0 }, { x: 10, y: 4 }])).toEqual({ x: 5, y: 2 });
  });
});

describe('build: raw samples -> stored strokes', () => {
  const box = LAYOUT.blocks[0] as (typeof LAYOUT.blocks)[number];
  const raw = Array.from({ length: 60 }, (_, i) => ({ x: 30 + i * 3, y: 10 + Math.sin(i / 6) * 8, p: 0.5 }));

  it('lands where the live stroke was drawn (same smoothing; within RDP + rounding tolerance)', () => {
    const [s] = buildStrokes({ raw, anchor: B1, box, tool: 'pen', color: 'p0', widthPx: 3, now: 1, newStrokeId: ctx().newStrokeId });
    if (!s) throw new Error('no stroke');
    expect(checkStroke(s)).toBeNull();
    const live = smoothStroke(raw);
    const stored = strokeToPx(s, box);
    // Every stored point is within RDP epsilon + quantisation of the live polyline.
    const tol = (0.35 + 0.71) * (box.width / 1000) + 1e-6;
    for (const p of stored) {
      const best = Math.min(...live.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
      expect(best).toBeLessThanOrEqual(tol + 0.3); // + chord distance between live samples
    }
    expect(stored[0]?.x).toBeCloseTo(raw[0]?.x ?? 0, 0);
  });

  it('drops pressure for the highlighter and keeps it for the pen', () => {
    const c = ctx();
    const [pen] = buildStrokes({ raw, anchor: B1, box, tool: 'pen', color: 'p1', widthPx: 3, now: 1, newStrokeId: c.newStrokeId });
    const [hl] = buildStrokes({ raw, anchor: B1, box, tool: 'hl', color: 'h0', widthPx: 14, now: 1, newStrokeId: c.newStrokeId });
    expect(pen?.p).toBeDefined();
    expect(hl?.p).toBeUndefined();
  });

  it('splits very long gestures into continuous valid pieces', () => {
    const long = Array.from({ length: 5_000 }, (_, i) => ({ x: 30 + (i % 300), y: 10 + i * 0.37 + ((i * 7919) % 13) }));
    const pieces = buildStrokes({ raw: long, anchor: B1, box, tool: 'pen', color: 'p0', widthPx: 3, now: 1, newStrokeId: ctx().newStrokeId });
    expect(pieces.length).toBeGreaterThan(1);
    expect(validateInkLayer(layerWith(pieces)).ok).toBe(true);
    for (let i = 1; i < pieces.length; i++) {
      const prevEnd = strokeToPx(pieces[i - 1] as (typeof pieces)[number], box).pop();
      const start = strokeToPx(pieces[i] as (typeof pieces)[number], box)[0];
      expect(prevEnd).toEqual(start);
    }
  });

  it('splitPoints shares joint points and widthToTenths clamps', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }));
    const runs = splitPoints(pts, 4);
    expect(runs.map((r) => r.length)).toEqual([4, 4, 4]);
    expect(runs[1]?.[0]).toEqual(runs[0]?.[3]);
    expect(widthToTenths(3, box)).toBe(83);
    expect(widthToTenths(1000, box)).toBe(INK_LIMITS.maxWidth);
    expect(widthToTenths(0, box)).toBe(INK_LIMITS.minWidth);
  });
});

describe('§9.2 reexpress (moving a stroke to another block)', () => {
  it('keeps the stroke where it is on the page, with the same px width', () => {
    const c = ctx();
    const from = LAYOUT.blocks[0] as (typeof LAYOUT.blocks)[number];
    const to = LAYOUT.blocks[2] as (typeof LAYOUT.blocks)[number];
    const [s] = buildStrokes({ raw: [{ x: 50, y: 20 }, { x: 90, y: 25 }, { x: 120, y: 18 }], anchor: B1, box: from, tool: 'pen', color: 'p0', widthPx: 4, now: 1, newStrokeId: c.newStrokeId });
    if (!s) throw new Error('no stroke');
    const moved = reexpress(s, from, to);
    expect(moved.b).toBe(B3);
    const a = strokeCentrePx(s, from);
    const b = strokeCentrePx(moved, to);
    expect(Math.abs(a.x - b.x)).toBeLessThan(1);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(widthPx(moved, to)).toBeCloseTo(widthPx(s, from), 1);
    // ... and by (dx, dy) when moved with the lasso.
    const shifted = reexpress(s, from, to, 10, -5);
    expect(strokeCentrePx(shifted, to).x - a.x).toBeCloseTo(10, 0);
  });
});

// ---------------------------------------------------------------------------
// Reconcile: strokes survive edits
// ---------------------------------------------------------------------------

const p = (id: string, text: string) => ({ type: 'paragraph' as const, attrs: { blockId: id }, content: text ? [{ type: 'text' as const, text }] : undefined });
const doc = (...content: NoteDoc['content']): NoteDoc => ({ type: 'doc', content });

describe('§9.3 reconcile', () => {
  const layout: InkLayout = {
    pageWidth: 400,
    blocks: [
      { id: B1, depth: 0, left: 20, top: 0, width: 360, height: 24 },
      { id: B2, depth: 0, left: 20, top: 30, width: 360, height: 24 },
      { id: B3, depth: 0, left: 20, top: 60, width: 360, height: 24 },
    ],
  };
  const strokeOn = (b: string, c = ctx()) => {
    const box = layout.blocks.find((x) => x.id === b) as (typeof layout.blocks)[number];
    const [s] = buildStrokes({ raw: [{ x: 40, y: box.top + 10 }, { x: 80, y: box.top + 12 }], anchor: b, box, tool: 'pen', color: 'p0', widthPx: 3, now: 1, newStrokeId: c.newStrokeId });
    return s as NonNullable<typeof s>;
  };
  const prev = doc(p(B1, 'Osmosis is'), p(B2, ' movement of water'), p(B3, 'Diffusion'));

  it('changes nothing when ids survive (typing, moving blocks, splitting)', () => {
    const l = layerWith([strokeOn(B2)]);
    const typed = doc(p(B1, 'Osmosis is the'), p(B3, 'Diffusion'), p(B2, ' movement of water'));
    expect(reconcile(prev, typed, l, layout, ctx()).layer).toBe(l);
    const split = doc(p(B1, 'Osmosis'), p('b_NEWNEWNEW01', ' is'), p(B2, ' movement of water'), p(B3, 'Diffusion'));
    expect(reconcile(prev, split, l, layout, ctx()).layer).toBe(l);
  });

  it('moves strokes of a JOINED block onto the block above, keeping their page position', () => {
    const c = ctx();
    const s = strokeOn(B2, c);
    const l = layerWith([s]);
    // ProseMirror join (Backspace at the start of B2): B1's text + B2's text, and B2's id disappears.
    const exact = doc(p(B1, 'Osmosis is' + ' movement of water'), p(B3, 'Diffusion'));
    const r = reconcile(prev, exact, l, layout, c);
    expect(r.layer.strokes).toHaveLength(1);
    const moved = r.layer.strokes[0] as (typeof r.layer.strokes)[number];
    expect(moved.b).toBe(B1);
    expect(moved.id).not.toBe(s.id); // immutable: new id + tombstone
    expect(r.layer.gone.map((g) => g.id)).toEqual([s.id]);
    expect(r.idMap.get(s.id)).toBe(moved.id);
    const before = strokeCentrePx(s, layout.blocks[1] as (typeof layout.blocks)[number]);
    const after = strokeCentrePx(moved, layout.blocks[0] as (typeof layout.blocks)[number]);
    expect(Math.abs(before.y - after.y)).toBeLessThan(1);
  });

  it('leaves strokes of a DELETED block detached (recoverable), not moved', () => {
    const l = layerWith([strokeOn(B2)]);
    const deleted = doc(p(B1, 'Osmosis is'), p(B3, 'Diffusion'));
    const r = reconcile(prev, deleted, l, layout, ctx());
    expect(r.layer).toBe(l);
    expect(r.applied).toBeNull();
  });

  it('does nothing without a previous layout (strokes stay detached and recoverable)', () => {
    const l = layerWith([strokeOn(B2)]);
    const exact = doc(p(B1, 'Osmosis is movement of water'), p(B3, 'Diffusion'));
    expect(reconcile(prev, exact, l, null, ctx()).layer).toBe(l);
  });

  it('scans text blocks in document order, including nested ones', () => {
    const nested: NoteDoc = doc(
      p(B1, 'a'),
      { type: 'bulletList', attrs: { blockId: 'b_LIST000000001' }, content: [{ type: 'listItem', attrs: { blockId: 'b_ITEM000000001' }, content: [p(B2, 'b')] }] },
    );
    const s = scanDoc(nested);
    expect(s.textblocks.map((t) => t.id)).toEqual([B1, B2]);
    expect(s.ids.has('b_LIST000000001')).toBe(true);
  });
});

describe('input routing (decision Q8)', () => {
  const base: RouteState = { mode: 'auto', fingerDraw: false, stylusSeen: false, penDown: false, penUpAt: 0, now: 10_000 };
  it.each([
    ['auto, no stylus yet: finger draws', { }, POINTER.TOUCH, 'draw'],
    ['auto, stylus seen: finger scrolls', { stylusSeen: true }, POINTER.TOUCH, 'scroll'],
    ['auto, stylus seen, "Draw with finger": finger draws', { stylusSeen: true, fingerDraw: true }, POINTER.TOUCH, 'draw'],
    ['stylus mode: finger scrolls', { mode: 'stylus' }, POINTER.TOUCH, 'scroll'],
    ['finger mode: finger draws', { mode: 'finger', stylusSeen: true }, POINTER.TOUCH, 'draw'],
    ['pen always draws', { mode: 'stylus' }, POINTER.STYLUS, 'draw'],
    ['mouse draws', {}, POINTER.MOUSE, 'draw'],
    ['palm while the pen is down: ignored', { penDown: true, fingerDraw: true }, POINTER.TOUCH, 'ignore'],
    ['palm just after the pen lifted: ignored', { penUpAt: 10_000 - PALM_AFTER_PEN_MS + 1 }, POINTER.TOUCH, 'ignore'],
    ['touch well after the pen lifted: normal', { penUpAt: 10_000 - PALM_AFTER_PEN_MS }, POINTER.TOUCH, 'draw'],
  ] as const)('%s', (_name, over, pointer, expected) => {
    expect(routePointer(pointer, { ...base, ...over })).toBe(expected);
  });
  it('cancels a touch when the pen lands within 150 ms after it', () => {
    expect(penCancelsTouch(1000, 1100)).toBe(true);
    expect(penCancelsTouch(1000, 1151)).toBe(false);
    expect(penCancelsTouch(1000, 900)).toBe(false);
  });
  it('starts a finger scroll only after 10 px', () => {
    expect(pastScrollSlop(6, 7)).toBe(false);
    expect(pastScrollSlop(6, 8)).toBe(true);
  });
});
