/**
 * Ink service against the REAL store (node:sqlite) and an in-memory file
 * system: saving, publishing for sync, recovery, deletion.
 */
import { createLogger, createSeqIdGenerator, memorySink, type NoteDoc } from '@/core';
import { applyOp, createInkService, emptyInkLayer, parseInkJson, publishedPath, serializeInk, workingPath, type InkFilesPort, type InkLayer, type InkStroke } from '@/modules/ink';
import { openStore, type Store } from '@/modules/store';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { inkStorePort } from '../ink';

/** In-memory InkFilesPort with write counting and failure injection. */
function memFiles() {
  const files = new Map<string, string>();
  const writes: string[] = [];
  let failNext = false;
  const port: InkFilesPort = {
    read: async (p) => files.get(p) ?? null,
    writeAtomic: async (p, t) => {
      if (failNext) {
        failNext = false;
        throw new Error('disk full');
      }
      writes.push(p);
      files.set(p, t);
    },
    remove: async (p) => {
      files.delete(p);
    },
    list: async (dir) => [...files.keys()].filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/')).map((k) => k.slice(dir.length + 1)),
  };
  return { port, files, writes, failNextWrite: () => (failNext = true) };
}

/** A manual timer queue (the 1.5 s working-copy debounce). */
function timers() {
  const q = new Map<number, () => void>();
  let id = 0;
  return {
    setTimer: (fn: () => void) => {
      q.set(++id, fn);
      return id;
    },
    clearTimer: (h: unknown) => {
      q.delete(h as number);
    },
    fire() {
      const fns = [...q.values()];
      q.clear();
      fns.forEach((f) => f());
    },
    get pending() {
      return q.size;
    },
  };
}

const B1 = 'b_AAAAAAAAAA01';
const B2 = 'b_AAAAAAAAAA02';
const doc = (...ids: string[]): NoteDoc => ({ type: 'doc', content: ids.map((id) => ({ type: 'paragraph' as const, attrs: { blockId: id }, content: [{ type: 'text' as const, text: id }] })) });

let sn = 0;
const stroke = (b = B1): InkStroke => ({ id: `s_X${String(++sn).padStart(15, '0')}`, b, tool: 'pen', c: 'p0', w: 30, o: [10, 10], d: [5, 5], t: 1_760_000_000_000 + sn });

async function setup() {
  let t = Date.UTC(2026, 10, 1);
  const now = () => (t += 10);
  const ids = createSeqIdGenerator();
  const sink = memorySink(200);
  const logger = createLogger({ sink, minLevel: 'debug' });
  const store = await openStore(nodeSqliteDriver(), { ids, logger, now });
  const fs = memFiles();
  const tm = timers();
  const ink = createInkService({ files: fs.port, store: inkStorePort(store), ids, logger, now, setTimer: tm.setTimer, clearTimer: tm.clearTimer });
  const note = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc(B1, B2) });
  const add = (layer: InkLayer, ...s: InkStroke[]) => {
    const r = applyOp(layer, { remove: [], add: s }, { newStrokeId: () => ids.newId('s'), now });
    if (!r.ok) throw new Error('full');
    return r.layer;
  };
  return { store, fs, tm, ink, note, add, sink, advance: (ms: number) => (t += ms) };
}

const assetOf = async (store: Store, noteId: string) => {
  const n = await store.notes.get(noteId);
  return n?.inkLayerRef ? store.assets.get(n.inkLayerRef) : null;
};

describe('ink service: saving', () => {
  it('opens an empty layer for a note without ink', async () => {
    const { ink, note } = await setup();
    const s = await ink.open(note.id);
    expect(s.source).toBe('empty');
    expect(s.layer).toEqual(emptyInkLayer(note.id));
  });

  it('autosaves only the LOCAL working copy while drawing: the synced row is untouched', async () => {
    const { ink, note, store, fs, tm, add } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke()));
    s.replace(add(s.layer, stroke()));
    expect(tm.pending).toBe(1); // debounced
    tm.fire();
    await s.flush();
    expect(fs.files.has(workingPath(note.id))).toBe(true);
    expect(fs.writes.every((p) => p.startsWith('ink/work/'))).toBe(true);
    const n = await store.notes.get(note.id);
    expect(n?.inkLayerRef).toBeNull(); // no synced change yet
    expect(await store.assets.list('ink')).toEqual([]);
  });

  it('flush() writes immediately (leaving Draw mode, app to the background)', async () => {
    const { ink, note, fs, add } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke()));
    await s.flush();
    expect(fs.writes).toEqual([workingPath(note.id)]);
    await s.flush(); // nothing new: no second write
    expect(fs.writes).toHaveLength(1);
  });

  it('keeps changes dirty when a working-copy write fails, and retries on the next flush', async () => {
    const { ink, note, fs, add } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke()));
    fs.failNextWrite();
    await s.flush();
    expect(s.dirty).toBe(true);
    await s.flush();
    expect(s.dirty).toBe(false);
    expect(fs.files.has(workingPath(note.id))).toBe(true);
  });
});

describe('ink service: publishing for sync (decision Q9)', () => {
  it('first publish creates the asset, links the note, writes the published file and removes the working copy', async () => {
    const { ink, note, store, fs, add } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke()));
    const r = await s.publish({ liveBlockIds: [B1, B2] });
    expect(r.published).toBe(true);
    expect(r.noteUpdated).toBeGreaterThan(note.updated);
    const a = await assetOf(store, note.id);
    expect(a).toMatchObject({ type: 'ink', deleted: false, localPath: publishedPath(a!.id) });
    const text = fs.files.get(a!.localPath!) as string;
    expect(a!.size).toBe(text.length); // P2a Storage rule: upload size == asset size
    expect(parseInkJson(text, { expectedNote: note.id }).ok).toBe(true);
    expect(fs.files.has(workingPath(note.id))).toBe(false);
  });

  it('publishes nothing when nothing changed (no upload) and nothing for a note never drawn on', async () => {
    const { ink, note, store, add } = await setup();
    const empty = await ink.open(note.id);
    expect((await empty.publish()).published).toBe(false);
    expect(await store.assets.list('ink')).toEqual([]);

    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke()));
    await s.publish();
    const a1 = await assetOf(store, note.id);
    const again = await ink.open(note.id);
    expect(again.source).toBe('published');
    expect((await again.publish()).published).toBe(false);
    const a2 = await assetOf(store, note.id);
    expect(a2?.updated).toBe(a1?.updated); // no synced change -> P2b uploads nothing
  });

  it('a later visit with changes updates the file and the asset size once', async () => {
    const { ink, note, store, fs, add } = await setup();
    const s1 = await ink.open(note.id);
    s1.replace(add(s1.layer, stroke()));
    await s1.publish();
    const before = await assetOf(store, note.id);
    const s2 = await ink.open(note.id);
    s2.replace(add(s2.layer, stroke(), stroke(B2)));
    const r = await s2.publish({ liveBlockIds: [B1, B2] });
    expect(r).toEqual({ published: true });
    const after = await assetOf(store, note.id);
    expect(after?.id).toBe(before?.id);
    expect(after?.size).toBe((fs.files.get(after!.localPath!) as string).length);
    expect(after?.size).toBeGreaterThan(before!.size);
  });

  it('purges strokes whose block is gone from the doc AND every version, but keeps recoverable ones', async () => {
    const { ink, note, store, add } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke(B1), stroke(B2), stroke('b_NOWHERE000001')));
    await s.publish();
    const layer = (await ink.read(note.id)) as InkLayer;
    expect(layer.strokes.map((x) => x.b).sort()).toEqual([B1, B2].sort());
    expect(layer.gone).toHaveLength(1);

    // B2 deleted from the doc but kept in a saved version: its stroke stays (detached, recoverable).
    await store.versions.snapshot(note.id, 'edit');
    await store.notes.save(note.id, { document: doc(B1) });
    const s2 = await ink.open(note.id);
    s2.replace(add(s2.layer, stroke(B1)));
    await s2.publish();
    expect(((await ink.read(note.id)) as InkLayer).strokes.some((x) => x.b === B2)).toBe(true);
  });

  it('keeps strokes on a block the editor has but the store has not saved yet', async () => {
    const { ink, note, add } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke('b_UNSAVED0000001')));
    await s.publish({ liveBlockIds: ['b_UNSAVED0000001'] });
    expect(((await ink.read(note.id)) as InkLayer).strokes).toHaveLength(1);
  });

  it('does not publish ink of a deleted note, and removes its working copy', async () => {
    const { ink, note, store, fs, add } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke()));
    await s.flush();
    await store.notes.remove([note.id]);
    expect((await s.publish()).published).toBe(false);
    expect(fs.files.has(workingPath(note.id))).toBe(false);
    expect(await store.assets.list('ink')).toEqual([]);
  });
});

describe('ink service: damaged files and recovery', () => {
  it('never loads a damaged file and never overwrites a good one with it', async () => {
    const { ink, note, store, fs, add } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke()));
    await s.publish();
    const a = await assetOf(store, note.id);
    fs.files.set(workingPath(note.id), '{"kind":"notedpo-ink","v":1,"note":"x"}'); // damaged leftover
    const s2 = await ink.open(note.id);
    expect(s2.damaged).toBe(true);
    expect(s2.source).toBe('published');
    expect(s2.layer.strokes).toHaveLength(1);
    expect(fs.files.get(a!.localPath!)).toContain('"strokes":[{');
  });

  it('a file for another note is treated as damaged', async () => {
    const { ink, note, fs } = await setup();
    fs.files.set(workingPath(note.id), serializeInk(emptyInkLayer('n_9999999999999999')));
    const s = await ink.open(note.id);
    expect(s.damaged).toBe(true);
    expect(s.source).toBe('empty');
  });

  it('recover() publishes drawings left unpublished by a crash and removes copies of missing notes', async () => {
    const { ink, note, store, fs, add } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke()));
    await s.flush(); // ...then the app is killed before leaving the note
    fs.files.set(workingPath('n_0000000000009999'), serializeInk(emptyInkLayer('n_0000000000009999')));
    fs.files.set('ink/work/notes.txt', 'x'); // not a <noteId>.json name: removed, never parsed
    const r = await ink.recover();
    expect(r).toEqual({ published: 1, removed: 2 });
    expect((await assetOf(store, note.id))?.deleted).toBe(false);
    expect(fs.files.has(workingPath(note.id))).toBe(false);
  });

  it('merges a leftover working copy with the published copy on open (nothing drawn is lost)', async () => {
    const { ink, note, add } = await setup();
    const s1 = await ink.open(note.id);
    const first = stroke();
    s1.replace(add(s1.layer, first));
    await s1.publish();
    const s2 = await ink.open(note.id);
    s2.replace(add(s2.layer, stroke(B2)));
    await s2.flush(); // crash before publish
    const s3 = await ink.open(note.id);
    expect(s3.source).toBe('merged');
    expect(s3.layer.strokes).toHaveLength(2);
  });
});

describe('ink service: deletion', () => {
  it('sweepOrphans() tombstones ink of purged notes and deletes the local file', async () => {
    const { ink, note, store, fs, add, advance } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke()));
    await s.publish();
    const a = await assetOf(store, note.id);
    await store.notes.remove([note.id]);
    expect(await ink.sweepOrphans()).toBe(0); // undo window: keep it
    advance(9_000);
    await store.purge();
    expect(await ink.sweepOrphans()).toBe(1);
    expect(fs.files.has(a!.localPath!)).toBe(false);
    expect((await store.assets.get(a!.id))?.deleted).toBe(true);
  });

  it('never logs stroke data', async () => {
    const { ink, note, add, sink } = await setup();
    const s = await ink.open(note.id);
    s.replace(add(s.layer, stroke()));
    await s.publish();
    const text = JSON.stringify(sink.records);
    expect(text).not.toMatch(/"d":\[|"o":\[|s_X0/);
  });
});
