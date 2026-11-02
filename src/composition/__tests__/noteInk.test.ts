/**
 * Draw mode end to end, without a device: createNoteInk with the REAL store
 * (node:sqlite), an in-memory file system and a fake editor handle that
 * records every bridge call.
 */
import * as z from 'zod';

import { createLogger, createSeqIdGenerator, memorySink, type NoteDoc } from '@/core';
import type { EditorHandle, InkLayoutMessage } from '@/modules/editor';
import { parseInkJson, type InkFilesPort } from '@/modules/ink';
import { openStore } from '@/modules/store';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { createNoteInk, KEY_INK_PREFS, KV_INK, LIVE_CLEAR_FALLBACK_MS, RENDER_BATCH, type NoteInkState } from '../noteInk';
import { inkServiceFor } from '../ink';

const B1 = 'b_AAAAAAAAAA01';
const B2 = 'b_AAAAAAAAAA02';
const doc = (...ids: string[]): NoteDoc => ({ type: 'doc', content: ids.map((id) => ({ type: 'paragraph' as const, attrs: { blockId: id }, content: [{ type: 'text' as const, text: id }] })) });
const LAYOUT: InkLayoutMessage = {
  v: 1,
  type: 'inkLayout',
  reqId: null,
  originX: 0,
  originY: 0,
  viewportWidth: 400,
  viewportHeight: 800,
  pageWidth: 400,
  blocks: [
    { id: B1, depth: 0, left: 20, top: 20, width: 360, height: 30 },
    { id: B2, depth: 0, left: 20, top: 60, width: 360, height: 30 },
  ],
};
const stroke = (y: number) => Array.from({ length: 20 }, (_, i) => ({ x: 40 + i * 6, y }));

function fakeEditor() {
  const calls: { name: string; args: unknown[] }[] = [];
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
  };
  const ed = {
    inkAdd: rec('inkAdd'),
    inkRemove: rec('inkRemove'),
    inkClear: rec('inkClear'),
    setInkFeed: rec('setInkFeed'),
    inkScroll: rec('inkScroll'),
    inkFling: rec('inkFling'),
    inkZoom: rec('inkZoom'),
    command: rec('command'),
  } as unknown as EditorHandle;
  return { ed, calls };
}

function memFiles(): InkFilesPort & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (p) => files.get(p) ?? null,
    writeAtomic: async (p, t) => {
      files.set(p, t);
    },
    remove: async (p) => {
      files.delete(p);
    },
    list: async (d) => [...files.keys()].filter((k) => k.startsWith(`${d}/`) && !k.slice(d.length + 1).includes('/')).map((k) => k.slice(d.length + 1)),
  };
}

const created: { dispose(): void }[] = [];
afterEach(() => {
  for (const c of created.splice(0)) c.dispose(); // cancels the session's 1.5 s working-copy timer
});

async function setup() {
  let t = Date.UTC(2026, 10, 1);
  const now = () => (t += 5);
  const ids = createSeqIdGenerator();
  const logger = createLogger({ sink: memorySink(), minLevel: 'debug' });
  const store = await openStore(nodeSqliteDriver(), { ids, logger, now });
  const files = memFiles();
  inkServiceFor(store, { ids, logger, files }); // the per-Store service uses the in-memory files
  const note = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc(B1, B2) });
  const { ed, calls } = fakeEditor();
  const states: NoteInkState[] = [];
  const seen: number[] = [];
  const timers: (() => void)[] = [];
  let latest: NoteDoc | null = doc(B1, B2);
  const ink = createNoteInk({
    store,
    ids,
    logger,
    noteId: note.id,
    editor: () => ed,
    getLatestDoc: () => latest,
    onNoteUpdated: (u) => seen.push(u),
    onState: (s) => states.push(s),
    now,
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  await ink.start();
  created.push(ink);
  return { ink, store, files, calls, states, seen, timers, note, setLatest: (d: NoteDoc) => (latest = d) };
}

describe('createNoteInk', () => {
  it('starts with an empty layer and shows (no) ink on the page', async () => {
    const { ink, calls } = await setup();
    expect(ink.state.ready).toBe(true);
    expect(ink.state.strokes).toBe(0);
    expect(calls.map((c) => c.name)).toEqual(['inkClear', 'inkAdd', 'setInkFeed']);
    expect(calls[2]?.args).toEqual([false]); // no strokes, not drawing: no layout feed
  });

  it('enters Draw mode (keyboard closes, layout feed on) and leaves it (zoom reset)', async () => {
    const { ink, calls } = await setup();
    ink.setDrawMode(true);
    expect(calls.slice(-2).map((c) => [c.name, c.args])).toEqual([['command', ['blur']], ['setInkFeed', [true]]]);
    expect(ink.state.drawMode).toBe(true);
    expect(ink.state.showTip).toBe(true);
    ink.setDrawMode(false);
    expect(calls.find((c) => c.name === 'inkZoom')?.args).toEqual([1]);
  });

  it('draws: sends the new stroke to the page, then publishes it for sync on leave', async () => {
    const { ink, calls, store, files, note, seen } = await setup();
    ink.setDrawMode(true);
    ink.onInkLayout(LAYOUT);
    ink.stroke(stroke(35));
    const add = calls.filter((c) => c.name === 'inkAdd').at(-1)?.args[0] as { b: string }[];
    expect(add).toHaveLength(1);
    expect(add[0]?.b).toBe(B1);
    expect(ink.state.canUndo).toBe(true);
    await ink.leave();
    const n = await store.notes.get(note.id);
    expect(n?.inkLayerRef).toBeTruthy();
    expect(seen).toHaveLength(1); // the screen marks the note row as seen (no reload)
    const a = await store.assets.get(n!.inkLayerRef!);
    const text = files.files.get(a!.localPath!) as string;
    expect(parseInkJson(text, { expectedNote: note.id }).ok).toBe(true);
  });

  it('re-sends all ink when the editor restarts', async () => {
    const { ink, calls } = await setup();
    ink.onInkLayout(LAYOUT);
    ink.stroke(stroke(35));
    calls.length = 0;
    ink.onEditorReady();
    expect(calls.map((c) => c.name)).toEqual(['inkClear', 'inkAdd', 'setInkFeed']);
    expect((calls[1]?.args[0] as unknown[]).length).toBe(1);
    expect(calls[2]?.args).toEqual([true]); // strokes exist: feed on for reconcile
  });

  it('drops the live copy when the page acknowledges, or after the fallback timer', async () => {
    const { ink, timers } = await setup();
    ink.onInkLayout(LAYOUT);
    const k0 = ink.state.clearKey;
    ink.stroke(stroke(35));
    ink.onInkAck();
    expect(ink.state.clearKey).toBe(k0 + 1);
    ink.stroke(stroke(75));
    expect(timers.length).toBeGreaterThan(0);
    timers.at(-1)?.();
    expect(ink.state.clearKey).toBe(k0 + 2);
    expect(LIVE_CLEAR_FALLBACK_MS).toBe(600);
  });

  it('reports a missing layout instead of drawing at a wrong place', async () => {
    const { ink } = await setup();
    ink.stroke(stroke(35));
    expect(ink.state.strokes).toBe(0);
    expect(ink.state.banner).toMatch(/still loading/);
    ink.dismissBanner();
    expect(ink.state.banner).toBeNull();
  });

  it('erases, undoes, and runs the lasso through the controller', async () => {
    const { ink } = await setup();
    ink.onInkLayout(LAYOUT);
    ink.stroke(stroke(35));
    ink.stroke(stroke(75));
    ink.setTools({ tool: 'eraser' });
    ink.eraseStart();
    ink.erase(80, 35);
    ink.eraseEnd();
    expect(ink.state.strokes).toBe(1);
    ink.undo();
    expect(ink.state.strokes).toBe(2);
    ink.setTools({ tool: 'lasso' });
    ink.lasso([{ x: 30, y: 25 }, { x: 200, y: 25 }, { x: 200, y: 45 }, { x: 30, y: 45 }]);
    expect(ink.state.selectionBox).not.toBeNull();
    ink.recolourSelection();
    ink.deleteSelection();
    expect(ink.state.strokes).toBe(1);
  });

  it('keeps ink on a joined block when the text changes (Type mode)', async () => {
    const { ink } = await setup();
    ink.onInkLayout(LAYOUT);
    ink.stroke(stroke(75)); // on B2
    ink.onDocChange(doc(B1, B2));
    ink.onDocChange({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: B1 }, content: [{ type: 'text', text: `${B1}${B2}` }] }] });
    expect(ink.controller?.layer.strokes[0]?.b).toBe(B1);
  });

  it('remembers preferences (stylus seen, input mode, side, tools) in kv, never synced', async () => {
    const { ink, store } = await setup();
    ink.stylusSeen();
    ink.setInputMode('stylus');
    ink.setSide('left');
    ink.toggleFingerDraw();
    ink.setTools({ tool: 'hl', width: 2 });
    await new Promise((r) => setTimeout(r, 0));
    const saved = (await store.kv.get(KV_INK, KEY_INK_PREFS, z.record(z.string(), z.unknown()))) as Record<string, unknown>;
    expect(saved).toMatchObject({ stylusSeen: true, inputMode: 'stylus', side: 'left', fingerDraw: true });
    expect(saved.tools).toMatchObject({ tool: 'hl', width: 2 });
  });

  it('counts and deletes hidden drawings of deleted lines', async () => {
    const { ink, setLatest } = await setup();
    ink.onInkLayout(LAYOUT);
    ink.stroke(stroke(75));
    setLatest(doc(B1));
    expect(ink.detachedCount()).toBe(1);
    expect(ink.deleteDetached()).toBe(1);
    expect(ink.state.strokes).toBe(0);
  });

  it('forwards scroll, fling and zoom to the page', async () => {
    const { ink, calls } = await setup();
    ink.scroll(0, 30);
    ink.fling(0, 900);
    ink.zoom(2);
    expect(calls.slice(-3).map((c) => [c.name, c.args])).toEqual([['inkScroll', [0, 30]], ['inkFling', [0, 900]], ['inkZoom', [2]]]);
  });
});

describe('createNoteInk: very full drawings', () => {
  it('shows a big layer in batches of 500 so the JS thread is never blocked for long', async () => {
    const ids = createSeqIdGenerator();
    const logger = createLogger({ sink: memorySink() });
    const store = await openStore(nodeSqliteDriver(), { ids, logger });
    const files = memFiles();
    inkServiceFor(store, { ids, logger, files });
    const note = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc(B1) });
    // A leftover working copy with 1,200 strokes (opened and merged on start).
    const strokes = Array.from({ length: 1_200 }, (_, i) => ({ id: `s_F${String(i).padStart(15, '0')}`, b: B1, tool: 'pen' as const, c: 'p0', w: 30, o: [10, 10] as [number, number], d: [5, 5], t: 1_760_000_000_000 + i }));
    files.files.set(`ink/work/${note.id}.json`, JSON.stringify({ kind: 'notedpo-ink', v: 1, note: note.id, unit: 1000, strokes, gone: [] }));
    const { ed, calls } = fakeEditor();
    const timers: (() => void)[] = [];
    const ink = createNoteInk({
      store, ids, logger, noteId: note.id, editor: () => ed, getLatestDoc: () => null, onNoteUpdated: () => undefined, onState: () => undefined,
      setTimer: (fn) => timers.push(fn), clearTimer: () => undefined,
    });
    await ink.start();
    created.push(ink);
    const sizes = () => calls.filter((c) => c.name === 'inkAdd').map((c) => (c.args[0] as unknown[]).length);
    expect(sizes()).toEqual([500]);
    while (timers.length) timers.shift()?.();
    expect(sizes()).toEqual([500, 500, 200]);
    expect(RENDER_BATCH).toBe(500);
  });
});
