/**
 * InkController: every drawing operation of Draw mode, as plain TypeScript
 * (no React, no Skia), so all of it is unit-tested. The screen feeds it
 * gestures in VIEW coordinates (px inside the editor WebView, the same as
 * the overlay's touch coordinates) and the latest layout from the page;
 * it answers with layer changes, which the screen draws (renderDiff) and
 * saves (InkSession.replace).
 *
 * Coordinate spaces:
 *   view px  --(minus page origin)-->  page px  --(anchor box, §1.2)-->  block units
 * Page px come from the page's own measurements (getBoundingClientRect), so
 * pinch zoom is already included: a stroke drawn at 2x is stored relative
 * to the (zoomed) block width and shows at the same place at 1x.
 *
 * Tools (decision Q5): pen, highlighter, eraser (whole strokes or partial),
 * lasso (select, then move, delete or recolour). Every change goes through
 * layer.applyOp, so caps, tombstones and undo always hold; one gesture is
 * one undo step.
 */
import type { NoteDoc } from '@/core';

import { indexLayout, pickAnchor, centreOf, reexpress, strokeToPx, widthPx, type InkLayout, type LayoutBlock } from './model/anchors';
import { buildStrokes } from './model/build';
import { pxToUnits, encodePoints, strokeBounds, unitsToPx, type InkPoint } from './model/codec';
import { colorAllowed, type InkLayer, type InkStroke } from './model/format';
import { createInkHistory, type InkHistory } from './model/history';
import { applyOp, detachedStrokes, type InkOp, type OpContext } from './model/layer';
import { HEX_COLOR, INK_LIMITS } from './model/limits';
import { reconcile, scanDoc } from './model/reconcile';
import { erasePartial, strokeInLasso, strokeTouchesCircle } from './geometry/hit';
import { renderDiff, type InkRenderItem } from './render';

export type InkToolName = 'pen' | 'hl' | 'eraser' | 'lasso';
export type EraserMode = 'stroke' | 'partial';

export interface InkToolState {
  tool: InkToolName;
  /** Which of the pack's three pens (p0..p2). */
  pen: 0 | 1 | 2;
  /** A custom "#RRGGBB" for the pen, or null to use the pack pen. */
  custom: string | null;
  /** 0 thin, 1 medium, 2 thick. */
  width: 0 | 1 | 2;
  eraserMode: EraserMode;
}

/** Pen widths in screen px (thin, medium, thick); the highlighter is wide. */
export const PEN_WIDTHS_PX = [1.6, 3, 5] as const;
export const HIGHLIGHTER_WIDTH_PX = [10, 14, 20] as const;
/** Eraser radius in screen px. */
export const ERASER_RADIUS_PX = 10;

export const DEFAULT_TOOLS: InkToolState = { tool: 'pen', pen: 0, custom: null, width: 1, eraserMode: 'stroke' };

/** The page layout as the controller needs it: block boxes in page px plus the page origin in view px. */
export interface InkViewLayout extends InkLayout {
  originX: number;
  originY: number;
}

export type InkChangeListener = (layer: InkLayer, diff: { remove: string[]; add: InkRenderItem[] }) => void;

export type CommitResult = { ok: true; ids: string[] } | { ok: false; reason: 'full' | 'no_layout' | 'empty' };

export interface ControllerDeps extends OpContext {
  onChange: InkChangeListener;
  history?: InkHistory;
}

const isPenKey = (c: string) => c === 'p0' || c === 'p1' || c === 'p2';

export function createInkController(initial: InkLayer, deps: ControllerDeps) {
  let layer = initial;
  let layout: InkViewLayout | null = null;
  let boxes = new Map<string, LayoutBlock>();
  let tools: InkToolState = { ...DEFAULT_TOOLS };
  let selection: string[] = [];
  const history = deps.history ?? createInkHistory();
  const ctx: OpContext = { newStrokeId: deps.newStrokeId, now: deps.now };

  /** Applies an op, notifies the screen, and records it for undo (unless told not to). */
  const commit = (op: InkOp, record = true): { ok: true; applied: InkOp; idMap: ReadonlyMap<string, string> } | { ok: false } => {
    const prev = layer;
    const r = applyOp(layer, op, ctx);
    if (!r.ok) return { ok: false };
    layer = r.layer;
    if (record) history.push(r.applied);
    history.remap(r.idMap);
    deps.onChange(layer, renderDiff(prev, layer));
    return { ok: true, applied: r.applied, idMap: r.idMap };
  };

  const toPage = (p: InkPoint): InkPoint => {
    const o = layout ?? { originX: 0, originY: 0 };
    return p.p === undefined ? { x: p.x - o.originX, y: p.y - o.originY } : { x: p.x - o.originX, y: p.y - o.originY, p: p.p };
  };

  /** Live strokes with a laid-out anchor, in page px (for hit tests). */
  const visible = (): { s: InkStroke; box: LayoutBlock }[] => {
    const out: { s: InkStroke; box: LayoutBlock }[] = [];
    for (const s of layer.strokes) {
      const box = boxes.get(s.b);
      if (box) out.push({ s, box });
    }
    return out;
  };

  /** Page-px bounding box of a stroke, cheap pre-filter for hit tests. */
  const pxBounds = (s: InkStroke, box: LayoutBlock): [number, number, number, number] => {
    const [x0, y0, x1, y1] = strokeBounds(s);
    const a = unitsToPx({ x: x0, y: y0 }, box);
    const b = unitsToPx({ x: x1, y: y1 }, box);
    return [a.x, a.y, b.x, b.y];
  };

  const strokeColour = (): string => {
    if (tools.tool === 'hl') return 'h0';
    if (tools.custom && HEX_COLOR.test(tools.custom)) return tools.custom;
    return (['p0', 'p1', 'p2'] as const)[tools.pen];
  };

  // ---- erasing: one gesture = one undo step -------------------------------
  let erase: { removed: Map<string, InkStroke>; added: Map<string, InkStroke> } | null = null;

  const api = {
    get layer() {
      return layer;
    },
    get tools() {
      return tools;
    },
    get selection(): readonly string[] {
      return selection;
    },
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },
    get hasLayout() {
      return layout !== null && layout.blocks.length > 0;
    },

    setLayout(next: InkViewLayout): void {
      layout = next;
      boxes = indexLayout(next);
    },

    setTools(patch: Partial<InkToolState>): void {
      tools = { ...tools, ...patch };
      if (tools.custom !== null && !HEX_COLOR.test(tools.custom)) tools.custom = null;
      if (tools.tool !== 'lasso') selection = [];
    },

    /** Colour key or hex of the current tool (for the live overlay and the toolbar). */
    currentColour: strokeColour,

    /** Width in screen px of the current tool. */
    currentWidthPx(): number {
      return tools.tool === 'hl' ? HIGHLIGHTER_WIDTH_PX[tools.width] : PEN_WIDTHS_PX[tools.width];
    },

    /** A finished pen or highlighter gesture (raw samples in view px). */
    commitStroke(raw: readonly InkPoint[], rec?: { r: string; ms: number }): CommitResult {
      if (raw.length === 0) return { ok: false, reason: 'empty' };
      if (!layout || layout.blocks.length === 0) return { ok: false, reason: 'no_layout' };
      const page = raw.map(toPage);
      const c = centreOf(page);
      const anchor = pickAnchor(layout, c.x, c.y);
      if (!anchor) return { ok: false, reason: 'no_layout' };
      const tool = tools.tool === 'hl' ? 'hl' : 'pen';
      const strokes = buildStrokes({
        raw: page,
        anchor: anchor.id,
        box: anchor,
        tool,
        color: strokeColour(),
        widthPx: tool === 'hl' ? HIGHLIGHTER_WIDTH_PX[tools.width] : PEN_WIDTHS_PX[tools.width],
        now: deps.now(),
        newStrokeId: deps.newStrokeId,
        rec,
      });
      if (strokes.length === 0) return { ok: false, reason: 'empty' };
      const r = commit({ remove: [], add: strokes });
      return r.ok ? { ok: true, ids: r.applied.add.map((s) => s.id) } : { ok: false, reason: 'full' };
    },

    beginErase(): void {
      erase = { removed: new Map(), added: new Map() };
    },

    /** One eraser sample at view (x, y). Applied immediately; recorded as one step at endErase(). */
    eraseAt(x: number, y: number): number {
      if (!erase) api.beginErase();
      const g = erase as NonNullable<typeof erase>;
      const p = toPage({ x, y });
      const r = ERASER_RADIUS_PX;
      const remove: InkStroke[] = [];
      const add: InkStroke[] = [];
      for (const { s, box } of visible()) {
        const [x0, y0, x1, y1] = pxBounds(s, box);
        const half = widthPx(s, box) / 2;
        if (p.x < x0 - r - half || p.x > x1 + r + half || p.y < y0 - r - half || p.y > y1 + r + half) continue;
        const pts = strokeToPx(s, box);
        if (tools.eraserMode === 'stroke' || s.tool === 'hl') {
          if (strokeTouchesCircle(pts, half, p.x, p.y, r)) remove.push(s);
          continue;
        }
        const pieces = erasePartial(pts, half, p.x, p.y, r, 1);
        if (pieces === null) continue;
        remove.push(s);
        for (const piece of pieces) {
          const enc = encodePoints(piece.map((q) => pxToUnits(q, box)));
          const n: InkStroke = { ...s, id: deps.newStrokeId(), o: enc.o, d: enc.d };
          if (enc.p) n.p = enc.p;
          else delete n.p;
          if (1 + n.d.length / 2 <= INK_LIMITS.maxPointsPerStroke) add.push(n);
        }
      }
      if (remove.length === 0) return 0;
      const res = commit({ remove, add }, false);
      if (!res.ok) return 0;
      for (const s of res.applied.remove) {
        if (g.added.has(s.id)) g.added.delete(s.id); // a piece from this same gesture
        else g.removed.set(s.id, s);
      }
      for (const s of res.applied.add) g.added.set(s.id, s);
      return res.applied.remove.length;
    },

    endErase(): void {
      if (erase && (erase.removed.size || erase.added.size)) {
        history.push({ remove: [...erase.removed.values()], add: [...erase.added.values()] });
      }
      erase = null;
    },

    /** Selects strokes at least half inside the lasso (view px polygon). Returns how many. */
    lassoSelect(poly: readonly InkPoint[]): number {
      const page = poly.map(toPage);
      selection = visible()
        .filter(({ s, box }) => strokeInLasso(strokeToPx(s, box), page))
        .map(({ s }) => s.id);
      return selection.length;
    },

    clearSelection(): void {
      selection = [];
    },

    /** Bounding box of the selection in VIEW px, or null. */
    selectionBox(): { x: number; y: number; width: number; height: number } | null {
      const o = layout ?? { originX: 0, originY: 0 };
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const { s, box } of visible()) {
        if (!selection.includes(s.id)) continue;
        const [a, b, c, d] = pxBounds(s, box);
        x0 = Math.min(x0, a);
        y0 = Math.min(y0, b);
        x1 = Math.max(x1, c);
        y1 = Math.max(y1, d);
      }
      if (!Number.isFinite(x0)) return null;
      return { x: x0 + o.originX, y: y0 + o.originY, width: x1 - x0, height: y1 - y0 };
    },

    /** Moves the selection by (dx, dy) view px; each stroke re-anchors to the block now under it. */
    moveSelection(dx: number, dy: number): boolean {
      if (!layout || selection.length === 0) return false;
      const remove: InkStroke[] = [];
      const add: InkStroke[] = [];
      for (const { s, box } of visible()) {
        if (!selection.includes(s.id)) continue;
        const c = centreOf(strokeToPx(s, box));
        const target = pickAnchor(layout, c.x + dx, c.y + dy) ?? box;
        remove.push(s);
        add.push({ ...reexpress(s, box, target, dx, dy), id: deps.newStrokeId() });
      }
      const r = commit({ remove, add });
      if (!r.ok) return false;
      selection = r.applied.add.map((s) => s.id);
      return true;
    },

    deleteSelection(): boolean {
      const remove = layer.strokes.filter((s) => selection.includes(s.id));
      if (!remove.length) return false;
      const r = commit({ remove, add: [] });
      if (r.ok) selection = [];
      return r.ok;
    },

    /** Recolours the selection: a pen key or "#RRGGBB" (highlighter strokes keep h0 unless a hex is given). */
    recolorSelection(colour: string): boolean {
      if (!isPenKey(colour) && !HEX_COLOR.test(colour)) return false;
      const remove: InkStroke[] = [];
      const add: InkStroke[] = [];
      for (const s of layer.strokes) {
        if (!selection.includes(s.id)) continue;
        const c = s.tool === 'hl' && isPenKey(colour) ? 'h0' : colour;
        if (c === s.c || !colorAllowed(s.tool, c)) continue;
        remove.push(s);
        add.push({ ...s, id: deps.newStrokeId(), c });
      }
      if (!remove.length) return false;
      const r = commit({ remove, add });
      // Keep strokes that didn't need a new colour selected, plus the recoloured ones (new ids).
      if (r.ok) {
        const changed = new Set(remove.map((s) => s.id));
        selection = [...selection.filter((id) => !changed.has(id)), ...r.applied.add.map((s) => s.id)];
      }
      return r.ok;
    },

    undo(): boolean {
      const op = history.peekUndo();
      if (!op) return false;
      const prev = layer;
      const r = applyOp(layer, op, ctx);
      if (!r.ok) return false;
      layer = r.layer;
      history.remap(r.idMap);
      history.commitUndo(r.applied);
      selection = [];
      deps.onChange(layer, renderDiff(prev, layer));
      return true;
    },

    redo(): boolean {
      const op = history.peekRedo();
      if (!op) return false;
      const prev = layer;
      const r = applyOp(layer, op, ctx);
      if (!r.ok) return false;
      layer = r.layer;
      history.remap(r.idMap);
      history.commitRedo(r.applied);
      selection = [];
      deps.onChange(layer, renderDiff(prev, layer));
      return true;
    },

    /** After a text edit: re-anchor strokes of joined blocks (§9.3), using the layout from before the edit. */
    applyDocChange(prevDoc: NoteDoc, nextDoc: NoteDoc): boolean {
      const r = reconcile(prevDoc, nextDoc, layer, layout, ctx);
      if (!r.applied) return false;
      const prev = layer;
      layer = r.layer;
      history.remap(r.idMap);
      deps.onChange(layer, renderDiff(prev, layer));
      return true;
    },

    /** Strokes hidden because their block is gone (for "Detached drawings"). */
    detached(doc: NoteDoc): InkStroke[] {
      return detachedStrokes(layer, scanDoc(doc).ids);
    },

    /** Deletes detached strokes (one undo step). */
    deleteDetached(doc: NoteDoc): number {
      const remove = api.detached(doc);
      if (!remove.length) return 0;
      return commit({ remove, add: [] }).ok ? remove.length : 0;
    },

    /** Replaces the whole layer (after a sync merge). Undo history is cleared: its steps referred to the old layer. */
    replaceLayer(next: InkLayer): void {
      const prev = layer;
      layer = next;
      history.clear();
      selection = [];
      deps.onChange(layer, renderDiff(prev, layer));
    },
  };
  return api;
}

export type InkController = ReturnType<typeof createInkController>;
