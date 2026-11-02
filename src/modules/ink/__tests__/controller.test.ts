import type { NoteDoc } from '@/core';

import { createInkController, type InkViewLayout } from '../controller';
import { strokeCentrePx } from '../model/anchors';
import { emptyInkLayer, validateInkLayer } from '../model/format';
import { B1, B2, B3, NOTE, ctx } from './helpers';

// The page is scrolled: its top-left corner is at view (8, -100).
const LAYOUT: InkViewLayout = {
  originX: 8,
  originY: -100,
  pageWidth: 400,
  blocks: [
    { id: B1, depth: 0, left: 20, top: 120, width: 360, height: 30 },
    { id: B2, depth: 0, left: 20, top: 160, width: 360, height: 30 },
    { id: B3, depth: 0, left: 20, top: 200, width: 360, height: 30 },
  ],
};
/** A horizontal line in VIEW px across the middle of a page-px row. */
const line = (pageY: number, x0 = 60, x1 = 200, n = 30) =>
  Array.from({ length: n }, (_, i) => ({ x: LAYOUT.originX + x0 + ((x1 - x0) * i) / (n - 1), y: LAYOUT.originY + pageY }));

function setup() {
  const c = ctx();
  const changes: { remove: string[]; add: string[] }[] = [];
  const ctl = createInkController(emptyInkLayer(NOTE), {
    ...c,
    onChange: (_l, d) => changes.push({ remove: d.remove, add: d.add.map((i) => i.id) }),
  });
  ctl.setLayout(LAYOUT);
  return { ctl, changes, c };
}

describe('InkController: drawing', () => {
  it('commits a stroke anchored to the block under it, in page coordinates', () => {
    const { ctl, changes } = setup();
    const r = ctl.commitStroke(line(135));
    expect(r.ok).toBe(true);
    expect(ctl.layer.strokes).toHaveLength(1);
    const s = ctl.layer.strokes[0] as (typeof ctl.layer.strokes)[number];
    expect(s.b).toBe(B1);
    expect(s.c).toBe('p0');
    const c = strokeCentrePx(s, LAYOUT.blocks[0] as (typeof LAYOUT.blocks)[number]);
    expect(c.y).toBeCloseTo(135, 0); // page px, not view px
    expect(changes).toEqual([{ remove: [], add: [s.id] }]);
    expect(validateInkLayer(ctl.layer).ok).toBe(true);
  });

  it('uses the highlighter key, custom colours and widths from the tool state', () => {
    const { ctl } = setup();
    ctl.setTools({ tool: 'hl' });
    expect(ctl.currentColour()).toBe('h0');
    expect(ctl.currentWidthPx()).toBe(14);
    ctl.commitStroke(line(175));
    expect(ctl.layer.strokes[0]).toMatchObject({ tool: 'hl', c: 'h0', b: B2 });
    ctl.setTools({ tool: 'pen', custom: '#1F3A5F', width: 2 });
    expect(ctl.currentColour()).toBe('#1F3A5F');
    ctl.setTools({ custom: 'red' }); // not a valid hex: ignored
    expect(ctl.currentColour()).toBe('p0');
  });

  it('refuses to draw before the page has reported a layout', () => {
    const c = ctx();
    const ctl = createInkController(emptyInkLayer(NOTE), { ...c, onChange: () => undefined });
    expect(ctl.commitStroke(line(135))).toEqual({ ok: false, reason: 'no_layout' });
    expect(ctl.commitStroke([])).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('InkController: eraser', () => {
  it('stroke mode removes whole strokes in one undo step per gesture', () => {
    const { ctl } = setup();
    ctl.commitStroke(line(135));
    ctl.commitStroke(line(175));
    ctl.beginErase();
    expect(ctl.eraseAt(LAYOUT.originX + 100, LAYOUT.originY + 135)).toBe(1);
    expect(ctl.eraseAt(LAYOUT.originX + 100, LAYOUT.originY + 175)).toBe(1);
    ctl.endErase();
    expect(ctl.layer.strokes).toHaveLength(0);
    expect(ctl.undo()).toBe(true); // both strokes back in one step
    expect(ctl.layer.strokes).toHaveLength(2);
  });

  it('partial mode splits a stroke and undo restores the original shape', () => {
    const { ctl } = setup();
    ctl.setTools({ eraserMode: 'partial' });
    ctl.commitStroke(line(135, 60, 300, 60));
    const before = JSON.stringify(ctl.layer.strokes.map((s) => [s.o, s.d]));
    ctl.beginErase();
    ctl.eraseAt(LAYOUT.originX + 180, LAYOUT.originY + 135);
    ctl.eraseAt(LAYOUT.originX + 185, LAYOUT.originY + 135); // erases from a piece made by this gesture
    ctl.endErase();
    expect(ctl.layer.strokes).toHaveLength(2);
    expect(validateInkLayer(ctl.layer).ok).toBe(true);
    ctl.undo();
    expect(ctl.layer.strokes).toHaveLength(1);
    expect(JSON.stringify(ctl.layer.strokes.map((s) => [s.o, s.d]))).toBe(before);
    ctl.redo();
    expect(ctl.layer.strokes).toHaveLength(2);
  });

  it('misses strokes it does not touch', () => {
    const { ctl } = setup();
    ctl.commitStroke(line(135));
    ctl.beginErase();
    expect(ctl.eraseAt(LAYOUT.originX + 350, LAYOUT.originY + 220)).toBe(0);
    ctl.endErase();
    expect(ctl.canUndo).toBe(true); // only the drawing step
    ctl.undo();
    expect(ctl.canUndo).toBe(false);
  });
});

describe('InkController: lasso', () => {
  const square = (x0: number, y0: number, x1: number, y1: number) =>
    [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }].map((p) => ({ x: p.x + LAYOUT.originX, y: p.y + LAYOUT.originY }));

  it('selects strokes inside the loop and moves them onto the block under their new position', () => {
    const { ctl } = setup();
    ctl.commitStroke(line(135));
    ctl.commitStroke(line(215));
    ctl.setTools({ tool: 'lasso' });
    expect(ctl.lassoSelect(square(40, 120, 250, 150))).toBe(1);
    const box = ctl.selectionBox();
    expect(box?.y).toBeCloseTo(LAYOUT.originY + 135, -1);
    expect(ctl.moveSelection(0, 40)).toBe(true);
    const moved = ctl.layer.strokes.find((s) => s.id === ctl.selection[0]);
    expect(moved?.b).toBe(B2);
    expect(strokeCentrePx(moved as NonNullable<typeof moved>, LAYOUT.blocks[1] as (typeof LAYOUT.blocks)[number]).y).toBeCloseTo(175, 0);
    ctl.undo();
    expect(ctl.layer.strokes.map((s) => s.b).sort()).toEqual([B1, B3].sort());
  });

  it('recolours (highlighter keeps h0 for a pen key) and deletes the selection', () => {
    const { ctl } = setup();
    ctl.commitStroke(line(135));
    ctl.setTools({ tool: 'hl' });
    ctl.commitStroke(line(140));
    ctl.setTools({ tool: 'lasso' });
    ctl.lassoSelect(square(40, 110, 250, 155));
    expect(ctl.selection).toHaveLength(2);
    expect(ctl.recolorSelection('p2')).toBe(true);
    expect(ctl.layer.strokes.map((s) => s.c).sort()).toEqual(['h0', 'p2']);
    expect(ctl.recolorSelection('url(#x)')).toBe(false);
    expect(ctl.deleteSelection()).toBe(true);
    expect(ctl.layer.strokes).toHaveLength(0);
    expect(ctl.selection).toHaveLength(0);
  });
});

describe('InkController: edits, detached strokes, replace', () => {
  const p = (id: string, text: string) => ({ type: 'paragraph' as const, attrs: { blockId: id }, content: [{ type: 'text' as const, text }] });
  const doc = (...c: NoteDoc['content']): NoteDoc => ({ type: 'doc', content: c });

  it('re-anchors strokes when blocks are joined (Backspace)', () => {
    const { ctl } = setup();
    ctl.commitStroke(line(175));
    const prev = doc(p(B1, 'a'), p(B2, 'b'), p(B3, 'c'));
    const next = doc(p(B1, 'ab'), p(B3, 'c'));
    expect(ctl.applyDocChange(prev, next)).toBe(true);
    expect(ctl.layer.strokes[0]?.b).toBe(B1);
  });

  it('lists and deletes detached strokes', () => {
    const { ctl } = setup();
    ctl.commitStroke(line(175));
    ctl.commitStroke(line(135));
    const d = doc(p(B1, 'a'), p(B3, 'c'));
    expect(ctl.detached(d)).toHaveLength(1);
    expect(ctl.deleteDetached(d)).toBe(1);
    expect(ctl.layer.strokes.map((s) => s.b)).toEqual([B1]);
  });

  it('replaces the layer after a merge and clears undo', () => {
    const { ctl, changes } = setup();
    ctl.commitStroke(line(135));
    ctl.replaceLayer(emptyInkLayer(NOTE));
    expect(ctl.canUndo).toBe(false);
    expect(changes.at(-1)?.remove).toHaveLength(1);
  });
});
