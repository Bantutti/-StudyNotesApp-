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
