/**
 * One note's ink while the editor is open (P4b). A plain object, like
 * createNoteSession, so the screen holds no logic and all of it is tested.
 *
 * It owns:
 *  - the InkSession (local working copy, publish on leave: decision Q9),
 *  - the InkController (tools, undo, reconcile),
 *  - showing ink on the page: everything on every editor 'ready' (the
 *    WebView can restart), then only the changes (renderDiff),
 *  - Draw mode state: tools, stylus-aware input, toolbar side, selection,
 *  - ink preferences in kv (namespace 'ink'), never synced.
 * The screen renders `state` and forwards events.
 */
import * as z from 'zod';

import { listBlockIds, type IdGenerator, type Logger, type NoteDoc } from '@/core';
import type { EditorHandle, InkLayoutMessage } from '@/modules/editor';
import {
  createInkController,
  DEFAULT_TOOLS,
  inkUsage,
  INK_LIMITS,
  PEN_KEYS,
  renderStroke,
  type InkController,
  type InkInputMode,
  type InkPoint,
  type InkSession,
  type InkToolState,
} from '@/modules/ink';
import type { Store } from '@/modules/store';

import { inkServiceFor } from './ink';

export const KV_INK = 'ink';
export const KEY_INK_PREFS = 'prefs';
/** How long the live stroke waits for the page's inkAck before it is dropped anyway. */
export const LIVE_CLEAR_FALLBACK_MS = 600;
/** Strokes rendered per batch when a whole layer is shown (open, WebView restart). */
export const RENDER_BATCH = 500;

const prefsSchema = z.object({
  stylusSeen: z.boolean().default(false),
  inputMode: z.enum(['auto', 'stylus', 'finger']).default('auto'),
  fingerDraw: z.boolean().default(false),
  side: z.enum(['left', 'right']).default('right'),
  tools: z
    .object({
      tool: z.enum(['pen', 'hl', 'eraser', 'lasso']),
      pen: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      custom: z.string().regex(/^#[0-9A-F]{6}$/).nullable(),
      width: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      eraserMode: z.enum(['stroke', 'partial']),
    })
    .default(DEFAULT_TOOLS),
  tipShown: z.boolean().default(false),
});
export type InkPrefs = z.infer<typeof prefsSchema>;

export interface NoteInkState {
  ready: boolean;
  drawMode: boolean;
  tools: InkToolState;
  canUndo: boolean;
  canRedo: boolean;
  selectionBox: { x: number; y: number; width: number; height: number } | null;
  stylusSeen: boolean;
  inputMode: InkInputMode;
  fingerDraw: boolean;
  side: 'left' | 'right';
  /** Bumped when the page drew committed strokes (the overlay drops its live copy). */
  clearKey: number;
  strokes: number;
  banner: string | null;
  /** Show the one-time "two fingers scroll" tip. */
  showTip: boolean;
}

export interface NoteInkDeps {
  store: Store;
  ids: IdGenerator;
  logger: Logger;
  noteId: string;
  editor: () => EditorHandle | null;
  /** The editor's newest document (it may be newer than the stored one). */
  getLatestDoc: () => NoteDoc | null;
  /** The note row changed because of ink (first drawing links the asset): mark it seen. */
  onNoteUpdated: (updated: number) => void;
  onState: (s: NoteInkState) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  strings?: { full: string; nearlyFull: string; noLayout: string; damaged: string };
}

const DEFAULT_STRINGS = {
  full: 'This drawing is full. Delete some strokes or start a new note.',
  nearlyFull: 'This drawing is nearly full.',
  noLayout: 'The page is still loading. Try again in a moment.',
  damaged: 'Part of this drawing could not be opened because its data is damaged. Your last good copy is shown.',
};

export function createNoteInk(deps: NoteInkDeps) {
  const now = deps.now ?? Date.now;
  const setT = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const S = deps.strings ?? DEFAULT_STRINGS;
  const log = deps.logger.child('ink.note');
  const svc = inkServiceFor(deps.store, { ids: deps.ids, logger: deps.logger });

  let session: InkSession | null = null;
  let ctl: InkController | null = null;
  let prefs: InkPrefs = prefsSchema.parse({});
  let drawMode = false;
  let clearKey = 0;
  let banner: string | null = null;
  let lastDoc: NoteDoc | null = null;
  let disposed = false;
  let liveTimer: unknown = null;

  const state = (): NoteInkState => ({
    ready: ctl !== null,
    drawMode,
    tools: ctl?.tools ?? prefs.tools,
    canUndo: ctl?.canUndo ?? false,
    canRedo: ctl?.canRedo ?? false,
    selectionBox: ctl?.selectionBox() ?? null,
    stylusSeen: prefs.stylusSeen,
    inputMode: prefs.inputMode,
    fingerDraw: prefs.fingerDraw,
    side: prefs.side,
    clearKey,
    strokes: ctl?.layer.strokes.length ?? 0,
    banner,
    showTip: drawMode && !prefs.tipShown,
  });
  const emit = () => {
    if (!disposed) deps.onState(state());
  };
  const savePrefs = (patch: Partial<InkPrefs>) => {
    prefs = { ...prefs, ...patch };
    void deps.store.kv.set(KV_INK, KEY_INK_PREFS, prefs).catch(() => log.warn('prefs_save_failed'));
  };

  /** The page shows ink: always when there are strokes (reconcile needs the layout too), and in Draw mode. */
  const updateFeed = () => deps.editor()?.setInkFeed(drawMode || (ctl?.layer.strokes.length ?? 0) > 0);

  /**
   * Shows the whole layer: the first RENDER_BATCH strokes at once, the rest in
   * later batches so a very full drawing never blocks the JS thread for long
   * (the synthetic bench: ~1 s to render 5,000 strokes in one go on Node).
   * A newer sendAll cancels batches still pending from an older one.
   */
  let sendGen = 0;
  const sendAll = () => {
    const ed = deps.editor();
    if (!ed || !ctl) return;
    const gen = ++sendGen;
    const strokes = ctl.layer.strokes;
    ed.inkClear();
    ed.inkAdd(strokes.slice(0, RENDER_BATCH).map(renderStroke));
    const next = (from: number) => {
      if (from >= strokes.length) return;
      setT(() => {
        if (gen !== sendGen || disposed) return;
        deps.editor()?.inkAdd(strokes.slice(from, from + RENDER_BATCH).map(renderStroke));
        next(from + RENDER_BATCH);
      }, 0);
    };
    next(RENDER_BATCH);
    updateFeed();
  };

  const bumpClear = () => {
    if (liveTimer !== null) clearT(liveTimer);
    liveTimer = null;
    clearKey += 1;
    emit();
  };

  const usageBanner = () => {
    if (!ctl) return;
    const u = inkUsage(ctl.layer);
    banner = u >= 1 ? S.full : u >= INK_LIMITS.warnRatio ? S.nearlyFull : banner === S.full || banner === S.nearlyFull ? null : banner;
  };

  const api = {
    get state() {
      return state();
    },
    get controller() {
      return ctl;
    },

    /** Opens the note's ink and loads preferences. Safe to call once per screen. */
    async start(): Promise<void> {
      const stored = await deps.store.kv.get(KV_INK, KEY_INK_PREFS, z.unknown()).catch(() => null);
      const parsed = prefsSchema.safeParse(stored ?? {});
      prefs = parsed.success ? parsed.data : prefsSchema.parse({});
      const s = await svc.open(deps.noteId);
      if (disposed) {
        s.dispose();
        return;
      }
      session = s;
      if (s.damaged) banner = S.damaged;
      ctl = createInkController(s.layer, {
        newStrokeId: () => deps.ids.newId('s'),
        now,
        onChange: (layer, diff) => {
          session?.replace(layer);
          const ed = deps.editor();
          if (diff.remove.length) ed?.inkRemove(diff.remove);
          if (diff.add.length) ed?.inkAdd(diff.add);
          updateFeed();
        },
      });
      ctl.setTools(prefs.tools);
      sendAll();
      emit();
    },

    /** Every editor 'ready' (first start and after a WebView restart): show all ink again. */
    onEditorReady(): void {
      sendAll();
    },

    onInkLayout(msg: InkLayoutMessage): void {
      ctl?.setLayout({ originX: msg.originX, originY: msg.originY, pageWidth: msg.pageWidth, blocks: msg.blocks });
      if (drawMode && ctl?.selection.length) emit(); // the selection box moved with the page
    },

    onInkAck(): void {
      bumpClear();
    },

    /** The editor reported a new document (Type mode edits): keep joined blocks' ink attached. */
    onDocChange(doc: NoteDoc): void {
      if (ctl && lastDoc) ctl.applyDocChange(lastDoc, doc);
      lastDoc = doc;
    },

    setDrawMode(on: boolean): void {
      if (on === drawMode) return;
      drawMode = on;
      const ed = deps.editor();
      if (on) ed?.command('blur');
      else {
        ed?.inkZoom(1);
        ctl?.clearSelection();
        void session?.flush();
      }
      updateFeed();
      emit();
    },

    dismissTip(): void {
      savePrefs({ tipShown: true });
      emit();
    },

    setTools(patch: Partial<InkToolState>): void {
      if (!ctl) return;
      ctl.setTools(patch);
      savePrefs({ tools: ctl.tools });
      emit();
    },

    // ---- gestures from the overlay ----------------------------------------
    stroke(points: InkPoint[]): void {
      if (!ctl) return;
      const r = ctl.commitStroke(points);
      if (!r.ok) {
        bumpClear();
        if (r.reason === 'full') banner = S.full;
        if (r.reason === 'no_layout') banner = S.noLayout;
      } else {
        usageBanner();
        // Fallback: drop the live copy even if the page never acknowledges.
        if (liveTimer !== null) clearT(liveTimer);
        liveTimer = setT(() => {
          liveTimer = null;
          bumpClear();
        }, LIVE_CLEAR_FALLBACK_MS);
      }
      emit();
    },
    eraseStart: () => ctl?.beginErase(),
    erase(x: number, y: number): void {
      ctl?.eraseAt(x, y);
    },
    eraseEnd(): void {
      ctl?.endErase();
      usageBanner();
      emit();
    },
    lasso(points: InkPoint[]): void {
      ctl?.lassoSelect(points);
      emit();
    },
    moveSelection(dx: number, dy: number): void {
      ctl?.moveSelection(dx, dy);
      emit();
    },
    deleteSelection(): void {
      ctl?.deleteSelection();
      emit();
    },
    /** Recolour cycles the selection through the pack's three pens. */
    recolourSelection(): void {
      if (!ctl) return;
      const first = ctl.layer.strokes.find((s) => ctl?.selection.includes(s.id) && s.tool === 'pen');
      const idx = first ? PEN_KEYS.indexOf(first.c as (typeof PEN_KEYS)[number]) : -1;
      ctl.recolorSelection(PEN_KEYS[(idx + 1) % 3] as string);
      emit();
    },
    clearSelection(): void {
      ctl?.clearSelection();
      emit();
    },
    undo(): void {
      ctl?.undo();
      emit();
    },
    redo(): void {
      ctl?.redo();
      emit();
    },
    scroll: (dx: number, dy: number) => deps.editor()?.inkScroll(dx, dy),
    fling: (vx: number, vy: number) => deps.editor()?.inkFling(vx, vy),
    zoom: (scale: number) => deps.editor()?.inkZoom(scale),
    stylusSeen(): void {
      if (prefs.stylusSeen) return;
      savePrefs({ stylusSeen: true });
      emit();
    },

    // ---- preferences ---------------------------------------------------------
    setSide(side: 'left' | 'right'): void {
      savePrefs({ side });
      emit();
    },
    setInputMode(inputMode: InkInputMode): void {
      savePrefs({ inputMode });
      emit();
    },
    toggleFingerDraw(): void {
      savePrefs({ fingerDraw: !prefs.fingerDraw });
      emit();
    },
    /** Hidden drawings of deleted lines (decision Q4). */
    detachedCount(): number {
      const doc = deps.getLatestDoc();
      return ctl && doc ? ctl.detached(doc).length : 0;
    },
    deleteDetached(): number {
      const doc = deps.getLatestDoc();
      const n = ctl && doc ? ctl.deleteDetached(doc) : 0;
      emit();
      return n;
    },
    dismissBanner(): void {
      banner = null;
      emit();
    },

    // ---- saving ---------------------------------------------------------------
    /** App to the background / leaving Draw mode: write the local working copy. */
    flush: () => session?.flush() ?? Promise.resolve(),
    /** Leaving the note: publish for sync (once per visit, only when changed). */
    async leave(): Promise<void> {
      if (!session) return;
      const doc = deps.getLatestDoc();
      const r = await session.publish({ liveBlockIds: doc ? listBlockIds(doc) : [] });
      if (r.noteUpdated !== undefined) deps.onNoteUpdated(r.noteUpdated);
    },
    dispose(): void {
      disposed = true;
      if (liveTimer !== null) clearT(liveTimer);
      session?.dispose();
    },
  };
  return api;
}

export type NoteInk = ReturnType<typeof createNoteInk>;
