import { spawnSync } from 'node:child_process';

import { createLogger, createSeqIdGenerator, memorySink, type NoteDoc } from '@/core';
import { openStore } from '@/modules/store';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { createNoteSession } from '../noteSession';

const doc = (text: string): NoteDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('note editing session', () => {
  it('saves edits, notices outside changes, and writes a leave version', async () => {
    let t = Date.UTC(2026, 10, 1);
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }), now: () => (t += 1000) });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('v1') });
    const banners: (string | null)[] = [];
    const s = createNoteSession({ store, noteId: n.id, onBanner: (b) => banners.push(b), now: () => t });
    s.seen(n.updated);
    expect(s.changedElsewhere(n.updated)).toBe(false);
    s.edited(doc('v2'));
    await s.autosave.flush();
    const saved = await store.notes.get(n.id);
    expect(JSON.stringify(saved?.document)).toContain('v2');
    expect(s.changedElsewhere(saved!.updated)).toBe(false); // our own save
    const r = await store.notes.save(n.id, { stylePackId: 'clear-read' }); // e.g. the Style sheet
    expect(s.changedElsewhere(r.note.updated)).toBe(true);
    await s.leave();
    expect((await store.versions.list(n.id)).map((v) => v.reason)).toContain('leave');
    expect(banners.every((b) => b === null)).toBe(true);
  });

  describe('live pull before saving (review M2: the last word is only in the WebView)', () => {
    async function open() {
      let t = Date.UTC(2026, 10, 1);
      const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }), now: () => (t += 1000) });
      const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('v1') });
      const s = createNoteSession({ store, noteId: n.id, onBanner: () => undefined, now: () => t, liveTimeoutMs: 50 });
      s.seen(n.updated);
      s.shown(n.document);
      const text = async () => JSON.stringify((await store.notes.get(n.id))!.document);
      return { store, n, s, text };
    }

    it('leave() saves what the editor holds now, not only what it already sent', async () => {
      const { store, n, s, text } = await open();
      s.edited(doc('The cell membrane is')); // sent 400 ms after typing stopped
      s.setLiveSource(async () => doc('The cell membrane is selectively permeable')); // the last word, never sent
      await s.leave();
      expect(await text()).toContain('selectively permeable');
      expect((await store.versions.list(n.id)).map((v) => v.reason)).toContain('leave');
    });

    it('flush() (app to background, before actions) also pulls the live document', async () => {
      const { s, text } = await open();
      s.setLiveSource(async () => doc('typed mid-composition'));
      await s.flush();
      expect(await text()).toContain('typed mid-composition');
    });

    it('a failed pull (invalid document, editor gone) or a slow one keeps the last good document', async () => {
      const { s, text } = await open();
      s.edited(doc('good'));
      s.setLiveSource(async () => {
        throw new Error('validation_failed');
      });
      await s.flush();
      expect(await text()).toContain('good');
      s.setLiveSource(() => new Promise<NoteDoc | null>(() => undefined)); // never answers
      s.edited(doc('good 2'));
      await s.flush(); // returns after liveTimeoutMs
      expect(await text()).toContain('good 2');
      s.setLiveSource(async () => null);
      await s.leave();
      expect(await text()).toContain('good 2');
    });

    it('does not replace a newer edit with a stale delayed live pull', async () => {
      const { s, text } = await open();
      let answer: (d: NoteDoc) => void = () => undefined;
      s.setLiveSource(() => new Promise<NoteDoc>((r) => (answer = r)));
      const flushing = s.flush();
      s.edited(doc('newer edit'));
      answer(doc('older live snapshot'));
      await flushing;
      expect(s.latestDoc).toEqual(doc('newer edit'));
      expect(await text()).toContain('newer edit');
      s.dispose();
    });

    it('dispose waits for an in-progress flush and its newer in-flight edit', async () => {
      const { store, s, text } = await open();
      const originalSave = store.notes.save.bind(store.notes);
      let release: () => void = () => undefined;
      let signalStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => { signalStarted = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const save = jest.spyOn(store.notes, 'save').mockImplementation(async (...args) => {
        if (save.mock.calls.length === 1) { signalStarted(); await gate; }
        return originalSave(...args);
      });
      s.edited(doc('first'));
      const flushing = s.flush();
      await started;
      s.edited(doc('newer'));
      s.dispose();
      release();
      await flushing;
      expect(await text()).toContain('newer');
      expect(save).toHaveBeenCalledTimes(2);
      expect(s.autosave.hasPending).toBe(false);
      s.edited(doc('after disposal'));
      expect(s.autosave.hasPending).toBe(false);
    });

    it('the screen unmounting (dispose) while leave() waits for the editor still saves the pulled text', async () => {
      const { s, text } = await open();
      let answer: (d: NoteDoc) => void = () => undefined;
      s.setLiveSource(() => new Promise<NoteDoc>((r) => (answer = r)));
      const leaving = s.leave();
      s.dispose(); // unmount right after blur
      answer(doc('last words before leaving'));
      await leaving;
      expect(await text()).toContain('last words before leaving');
    });
  });

  it('does not produce a second unhandled rejection when the caller catches a leave checkpoint failure', () => {
    // Node's strict unhandled-rejection mode observes discarded promise chains independently of Jest.
    const script = `
      const esbuild = require('esbuild');
      const vm = require('node:vm');
      (async () => {
        const built = await esbuild.build({
          entryPoints: ['src/composition/noteSession.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
          plugins: [{ name: 'core-stub', setup(build) {
            build.onResolve({ filter: /^@\\/core$/ }, () => ({ path: 'stub', namespace: 'test' }));
            build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const DOCUMENT_LIMITS={warnRatio:0.85}; export const t=(key)=>key; export const userMessage=(e)=>e.message;', loader: 'js' }));
          }}],
        });
        const mod = { exports: {} };
        vm.runInNewContext(built.outputFiles[0].text, { module: mod, exports: mod.exports, Date, setTimeout, clearTimeout, Promise });
        const failure = new Error('synthetic checkpoint failure');
        const s = mod.exports.createNoteSession({
          store: { notes: { save: async () => ({ note: { updated: 1 }, usage: 0 }) }, versions: { latestAt: async () => Date.now(), snapshot: async () => { throw failure; } } },
          noteId: 'synthetic', onBanner: () => {},
        });
        s.edited({ type: 'doc', content: [] });
        await s.flush();
        const leaving = s.leave();
        s.dispose();
        try { await leaving; throw new Error('leave should reject'); }
        catch (e) { if (e !== failure) throw e; }
        await new Promise((resolve) => setImmediate(resolve));
        console.log('caught once');
      })().catch((e) => { console.error(e); process.exitCode = 1; });
    `;
    const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script], { cwd: process.cwd(), encoding: 'utf8' });
    expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' });
    expect(child.stdout).toContain('caught once');
  });

  it('leave and disposal wait for edits arriving during an in-flight save', async () => {
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }) });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('start') });
    const originalSave = store.notes.save.bind(store.notes);
    let release: () => void = () => undefined;
    let saveStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { saveStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const saveSpy = jest.spyOn(store.notes, 'save').mockImplementation(async (...args) => {
      if (saveSpy.mock.calls.length === 1) {
        saveStarted();
        await gate;
      }
      return originalSave(...args);
    });
    const s = createNoteSession({ store, noteId: n.id, onBanner: () => undefined });
    s.edited(doc('first'));
    const leaving = s.leave();
    await started;
    s.edited(doc('newer during save'));
    s.dispose();
    release();
    await leaving;
    expect(JSON.stringify((await store.notes.get(n.id))?.document)).toContain('newer during save');
    expect(s.autosave.hasPending).toBe(false);
    expect(saveSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps autosave alive until all overlapping leave calls finish, even after disposal is requested', async () => {
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }) });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('start') });
    const s = createNoteSession({ store, noteId: n.id, onBanner: () => undefined });
    s.edited(doc('saved'));
    await s.flush();
    const releases: (() => void)[] = [];
    jest.spyOn(store.versions, 'snapshot').mockImplementation(() => {
      if (releases.length >= 2) return Promise.resolve(null);
      return new Promise((resolve) => { releases.push(() => resolve(null)); });
    });
    const first = s.leave();
    const second = s.leave();
    // Wait for both independent leave checkpoints to be reached.
    await new Promise((r) => setTimeout(r, 0));
    expect(releases).toHaveLength(2);
    s.dispose();
    releases[0]!();
    await first;
    s.edited(doc('while second leave is pending'));
    expect(s.autosave.hasPending).toBe(true);
    releases[1]!();
    await second;
    expect(JSON.stringify((await store.notes.get(n.id))?.document)).toContain('while second leave is pending');
    expect(s.autosave.hasPending).toBe(false);
    s.edited(doc('after disposal'));
    expect(s.autosave.hasPending).toBe(false);
  });

  it('reports a failed leave history checkpoint while preserving the rejection and cleaning up on disposal', async () => {
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }) });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('start') });
    const banners: (string | null)[] = [];
    const s = createNoteSession({ store, noteId: n.id, onBanner: (b) => banners.push(b) });
    s.edited(doc('saved'));
    await s.flush();
    const failure = new Error('synthetic checkpoint failure');
    jest.spyOn(store.versions, 'snapshot').mockRejectedValue(failure);
    const leaving = s.leave();
    s.dispose();
    await expect(leaving).rejects.toBe(failure);
    expect(banners.at(-1)).toMatch(/could not save the leave history version/i);
    s.edited(doc('after disposal'));
    expect(s.autosave.hasPending).toBe(false);
  });

  it('does not checkpoint an outdated document on leave when saving fails', async () => {
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }) });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('start') });
    const s = createNoteSession({ store, noteId: n.id, onBanner: () => undefined });
    s.edited(doc('saved'));
    await s.flush();
    jest.spyOn(store.notes, 'save').mockRejectedValue(new Error('disk full'));
    const snapshot = jest.spyOn(store.versions, 'snapshot');
    s.edited(doc('unsaved'));
    await s.leave();
    expect(snapshot).not.toHaveBeenCalled();
    expect(s.autosave.hasPending).toBe(true);
    expect(s.latestDoc).toEqual(doc('unsaved'));
    s.dispose();
  });

  it('saves a newer edit before disposing even if the leave checkpoint fails', async () => {
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }) });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('start') });
    const s = createNoteSession({ store, noteId: n.id, onBanner: () => undefined });
    s.edited(doc('first'));
    await s.flush();
    let rejectCheckpoint: (e: Error) => void = () => undefined;
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    jest.spyOn(store.versions, 'snapshot').mockImplementation(() => {
      signalStarted();
      return new Promise((_, reject) => { rejectCheckpoint = reject; });
    });
    const leaving = s.leave();
    await started;
    s.edited(doc('during checkpoint'));
    s.dispose();
    const failure = new Error('history failed');
    rejectCheckpoint(failure);
    await expect(leaving).rejects.toBe(failure);
    expect(JSON.stringify((await store.notes.get(n.id))?.document)).toContain('during checkpoint');
    expect(s.autosave.hasPending).toBe(false);
  });

  it('shows a recovery banner after an autosave failure while keeping the edited document pending', async () => {
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }) });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('start') });
    jest.spyOn(store.notes, 'save').mockRejectedValue(new Error('synthetic failure'));
    const banners: (string | null)[] = [];
    const s = createNoteSession({ store, noteId: n.id, onBanner: (b) => banners.push(b) });
    s.edited(doc('unsaved'));
    await s.flush();
    expect(s.autosave.hasPending).toBe(true);
    expect(s.readyDoc(n.document)).toEqual(doc('unsaved'));
    expect(banners.at(-1)).toMatch(/not saved yet/i);
    expect(banners.at(-1)).toMatch(/keep.*open/i);
    s.dispose();
  });

  it('readyDoc: after a WebView restart the newest document is shown, not the one from opening (review M3)', async () => {
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }) });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('opened') });
    const s = createNoteSession({ store, noteId: n.id, onBanner: () => undefined });
    expect(s.readyDoc(n.document)).toEqual(n.document);
    s.shown(n.document);
    s.edited(doc('newer, not saved yet'));
    expect(s.readyDoc(n.document)).toEqual(doc('newer, not saved yet'));
    expect(s.autosave.hasPending).toBe(true); // the restart does not drop the pending save
    s.dispose();
  });
});
