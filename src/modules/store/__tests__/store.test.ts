import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as z from 'zod';

import { BLOCK_ID, EMPTY_DOC_JSON, ENTITY_ID_PATTERN, listBlockIds, SAMPLE_NOTE } from '@/core';

import { UNDO_WINDOW_MS, VERSIONS_KEPT, WIPED_NAME } from '../index';
import { doc, makeStore, para } from './helpers';

const PACK = 'pastel-highlight';

describe('subjects', () => {
  it('creates a subject with cleaned input in the cloud format', async () => {
    const { store } = await makeStore();
    const s = await store.subjects.create({ name: '  Bio\u202Elogy\n 101 ', color: '#4f7cf7', examDates: [3, 1, 3] });
    expect(s).toMatchObject({ name: 'Bio logy 101', color: '4F7CF7', icon: 'book', owner: null, rev: 0, deleted: false });
    expect(s.examDates).toEqual([1, 3]);
    expect(s.id).toMatch(ENTITY_ID_PATTERN);
  });

  it('measures names in UTF-16 units like the Firestore rules', async () => {
    const { store } = await makeStore();
    await expect(store.subjects.create({ name: '😀'.repeat(40), color: '4F7CF7' })).resolves.toBeTruthy(); // 80 units
    await expect(store.subjects.create({ name: '😀'.repeat(41), color: '4F7CF7' })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('rejects empty names, bad colours, bad icons and too many exam dates', async () => {
    const { store } = await makeStore();
    await expect(store.subjects.create({ name: ' \n ', color: '4F7CF7' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(store.subjects.create({ name: 'A', color: 'red' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(store.subjects.create({ name: 'A', color: '4F7CF7', icon: 'Bad Icon' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      store.subjects.create({ name: 'A', color: '4F7CF7', examDates: Array.from({ length: 11 }, (_, i) => i) }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('updates and lists subjects by name', async () => {
    const { store, clock } = await makeStore();
    const b = await store.subjects.create({ name: 'b', color: '111111' });
    await store.subjects.create({ name: 'A', color: '222222' });
    clock.advance(1000);
    const u = await store.subjects.update(b.id, { name: 'Chem', defaultPack: 'clear-read', aiAllowed: false });
    expect(u).toMatchObject({ name: 'Chem', defaultPack: 'clear-read', aiAllowed: false });
    expect(u.updated).toBeGreaterThan(b.updated);
    expect((await store.subjects.list()).map((s) => s.name)).toEqual(['A', 'Chem']);
  });
});

describe('notes', () => {
  it('creates an empty note whose single block has a valid id', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK });
    expect(n).toMatchObject({ subject: null, folder: null, title: '', owner: null, rev: 0, deleted: false, tags: [] });
    expect(n.document.content).toHaveLength(1);
    expect(listBlockIds(n.document)[0]).toMatch(BLOCK_ID);
  });

  it('refuses links to missing subjects or folders of another subject', async () => {
    const { store } = await makeStore();
    await expect(store.notes.create({ stylePackId: PACK, subject: 's_0000000000000099' })).rejects.toMatchObject({ code: 'not_found' });
    const a = await store.subjects.create({ name: 'A', color: '111111' });
    const b = await store.subjects.create({ name: 'B', color: '222222' });
    const fa = await store.folders.create({ subject: a.id, name: 'Week 1' });
    await expect(store.notes.create({ stylePackId: PACK, subject: b.id, folder: fa.id })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('keeps existing block ids, fills missing ones and fixes duplicates on save', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK });
    const keep = 'b_keepThisId0001';
    await store.notes.save(n.id, { document: doc(para('one', keep), para('two'), para('three', keep)) });
    const saved = await store.notes.get(n.id);
    const ids = listBlockIds(saved!.document);
    expect(ids[0]).toBe(keep);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => BLOCK_ID.test(id))).toBe(true);
  });

  it('rejects an invalid document without writing anything', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK, document: doc(para('safe')) });
    const evil = doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] } as never);
    await expect(store.notes.save(n.id, { document: evil, title: 'changed' })).rejects.toMatchObject({ code: 'validation_failed' });
    const after = await store.notes.get(n.id);
    expect(after!.title).toBe('');
    expect(after!.document.content[0]).toMatchObject({ content: [{ text: 'safe' }] });
  });

  it('enforces the cloud size cap and reports usage', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK });
    const big = (chars: number) => doc(...Array.from({ length: Math.ceil(chars / 10_000) }, () => para('x'.repeat(10_000))));
    const ok = await store.notes.save(n.id, { document: big(480_000) });
    expect(ok.usage).toBeGreaterThan(0.8);
    expect(ok.usage).toBeLessThanOrEqual(1);
    await expect(store.notes.save(n.id, { document: big(610_000) })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('cleans titles and tags and enforces their limits', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK });
    const r = await store.notes.save(n.id, { title: '  Cell\u0000 biology ', tags: ['#exam', 'Exam', ' lab ', ''] });
    expect(r.note.title).toBe('Cell biology');
    expect(r.note.tags).toEqual(['exam', 'lab']);
    await expect(store.notes.save(n.id, { title: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(store.notes.save(n.id, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(store.notes.save(n.id, { stylePackId: '<script>' })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('drops the folder when a note moves to another subject', async () => {
    const { store } = await makeStore();
    const a = await store.subjects.create({ name: 'A', color: '111111' });
    const b = await store.subjects.create({ name: 'B', color: '222222' });
    const f = await store.folders.create({ subject: a.id, name: 'Week 1' });
    const n = await store.notes.create({ stylePackId: PACK, subject: a.id, folder: f.id });
    const r = await store.notes.save(n.id, { subject: b.id });
    expect(r.note).toMatchObject({ subject: b.id, folder: null });
  });

  it('lists by scope, folder and tag, with a text preview', async () => {
    const { store, clock } = await makeStore();
    const s = await store.subjects.create({ name: 'Bio', color: '111111' });
    const f = await store.folders.create({ subject: s.id, name: 'Week 1' });
    const inbox = await store.notes.create({ stylePackId: PACK, title: 'Loose idea', document: doc(para('Buy pens')) });
    clock.advance(10);
    const root = await store.notes.create({ stylePackId: PACK, subject: s.id, title: 'Zeta', tags: ['exam'] });
    clock.advance(10);
    const inF = await store.notes.create({ stylePackId: PACK, subject: s.id, folder: f.id, title: 'alpha', document: doc(para('Mitosis basics')) });

    const idsOf = (xs: { id: string }[]) => xs.map((x) => x.id);
    expect(idsOf(await store.notes.list({ scope: 'all' }))).toEqual([inF.id, root.id, inbox.id]);
    expect(idsOf(await store.notes.list({ scope: 'inbox' }))).toEqual([inbox.id]);
    expect(idsOf(await store.notes.list({ scope: 'subject', subjectId: s.id }))).toEqual([inF.id, root.id]);
    expect(idsOf(await store.notes.list({ scope: 'subject', subjectId: s.id, folderId: null }))).toEqual([root.id]);
    expect(idsOf(await store.notes.list({ scope: 'subject', subjectId: s.id, folderId: f.id }))).toEqual([inF.id]);
    expect(idsOf(await store.notes.list({ scope: 'all' }, { tag: 'exam' }))).toEqual([root.id]);
    expect(idsOf(await store.notes.list({ scope: 'subject', subjectId: s.id }, { sort: 'title' }))).toEqual([inF.id, root.id]);
    expect((await store.notes.list({ scope: 'inbox' }))[0]?.preview).toBe('Buy pens');
    const inboxFolder = await store.folders.create({ subject: null, name: 'Loose' });
    const inFolder = await store.notes.create({ stylePackId: PACK, folder: inboxFolder.id });
    expect(idsOf(await store.notes.list({ scope: 'inbox', folderId: null }))).toEqual([inbox.id]);
    expect(idsOf(await store.notes.list({ scope: 'inbox', folderId: inboxFolder.id }))).toEqual([inFolder.id]);
    expect(await store.notes.list({ scope: 'inbox' })).toHaveLength(2);
    await store.notes.remove([inFolder.id]);
    expect((await store.notes.counts()).get(s.id)).toBe(2);
    expect(await store.notes.tags()).toEqual([{ tag: 'exam', count: 1 }]);
  });
});

describe('versions', () => {
  it('saves a version before a change, skips duplicates and restores exact ids and pack', async () => {
    const { store, clock } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK, title: 'v1', document: SAMPLE_NOTE });
    clock.advance(1000);
    await store.notes.save(n.id, { stylePackId: 'clear-read' }, { before: 'before_pack' });
    clock.advance(1000);
    expect(await store.versions.snapshot(n.id, 'edit')).not.toBeNull();
    expect(await store.versions.snapshot(n.id, 'edit')).toBeNull(); // duplicate
    await store.notes.save(n.id, { document: doc(para('rewritten')), title: 'v2' }, { before: 'before_beautify' });

    const list = await store.versions.list(n.id);
    // The duplicate 'edit' version was relabelled 'before_beautify' (same content).
    expect(list.map((v) => v.reason)).toEqual(['before_beautify', 'before_pack']);
    const first = list[1]!;
    const restored = await store.versions.restore(n.id, first.id);
    const now = await store.notes.get(n.id);
    expect(now).toMatchObject({ title: 'v1', stylePackId: PACK });
    expect(listBlockIds(now!.document)).toEqual(listBlockIds(SAMPLE_NOTE));
    expect(restored.document).toEqual(SAMPLE_NOTE);
    expect((await store.versions.list(n.id))[0]?.reason).toBe('before_restore');
  });

  it(`keeps only the newest ${VERSIONS_KEPT} versions`, async () => {
    const { store, clock } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK });
    for (let i = 0; i < VERSIONS_KEPT + 5; i++) {
      clock.advance(1000);
      await store.notes.save(n.id, { document: doc(para(`edit ${i}`)) }, { before: 'edit' });
    }
    const list = await store.versions.list(n.id);
    expect(list).toHaveLength(VERSIONS_KEPT);
    const newest = await store.versions.get(list[0]!.id);
    expect(newest!.document.content[0]).toMatchObject({ content: [{ text: `edit ${VERSIONS_KEPT + 3}` }] });
  });

  it("refuses to restore another note's version", async () => {
    const { store } = await makeStore();
    const a = await store.notes.create({ stylePackId: PACK, document: doc(para('a')) });
    const b = await store.notes.create({ stylePackId: PACK });
    const v = await store.versions.snapshot(a.id, 'edit');
    await expect(store.versions.restore(b.id, v!.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('delete, undo and wipe (decision Q11)', () => {
  it('hides a deleted note, undoes it, and wipes its text after the window', async () => {
    const { store, clock } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK, title: 'Secret plan', tags: ['x'], document: doc(para('osmosis secrets')) });
    await store.versions.snapshot(n.id, 'edit');
    const token = await store.notes.remove([n.id]);
    expect(await store.notes.list({ scope: 'all' })).toHaveLength(0);
    expect(await store.search('osmosis')).toHaveLength(0);
    expect(await store.undo(token)).toBe(true);
    expect(await store.search('osmosis')).toHaveLength(1);

    const token2 = await store.notes.remove([n.id]);
    clock.advance(UNDO_WINDOW_MS - 1);
    expect(await store.purge()).toBe(0); // still undoable
    clock.advance(2);
    expect(await store.purge()).toBe(1);
    expect(await store.undo(token2)).toBe(false);
    const raw = await store.notes.get(n.id);
    expect(raw).toMatchObject({ deleted: true, title: '', tags: [] });
    expect(JSON.stringify(raw!.document)).toBe(EMPTY_DOC_JSON);
    expect(await store.versions.list(n.id)).toHaveLength(0);
    expect(await store.search('secret')).toHaveLength(0);
  });

  it('deleting a subject can move its notes and folders to the Inbox, with undo', async () => {
    const { store } = await makeStore();
    const s = await store.subjects.create({ name: 'Bio', color: '111111' });
    const f = await store.folders.create({ subject: s.id, name: 'Week 1' });
    const n = await store.notes.create({ stylePackId: PACK, subject: s.id, folder: f.id });
    const token = await store.subjects.remove(s.id, 'move');
    expect(await store.subjects.list()).toHaveLength(0);
    expect((await store.notes.list({ scope: 'inbox' })).map((x) => x.id)).toEqual([n.id]);
    expect((await store.folders.list(null)).map((x) => x.id)).toEqual([f.id]);
    expect(await store.undo(token)).toBe(true);
    expect((await store.notes.list({ scope: 'subject', subjectId: s.id, folderId: f.id })).map((x) => x.id)).toEqual([n.id]);
  });

  it('deleting a subject with its notes wipes everything after the window', async () => {
    const { store, clock } = await makeStore();
    const s = await store.subjects.create({ name: 'Private', color: '111111' });
    await store.folders.create({ subject: s.id, name: 'Diary' });
    await store.notes.create({ stylePackId: PACK, subject: s.id, title: 'Dear diary' });
    await store.subjects.remove(s.id, 'delete');
    expect(await store.notes.list({ scope: 'all' })).toHaveLength(0);
    clock.advance(UNDO_WINDOW_MS + 1);
    await store.purge();
    expect((await store.subjects.get(s.id))?.name).toBe(WIPED_NAME);
  });

  it('deleting a folder moves its notes up to the subject, with undo', async () => {
    const { store } = await makeStore();
    const s = await store.subjects.create({ name: 'Bio', color: '111111' });
    const f = await store.folders.create({ subject: s.id, name: 'Week 1' });
    const sub = await store.folders.create({ subject: s.id, name: 'Day 1', parent: f.id });
    const n = await store.notes.create({ stylePackId: PACK, subject: s.id, folder: f.id });
    const token = await store.folders.remove(f.id);
    expect((await store.notes.list({ scope: 'subject', subjectId: s.id, folderId: null })).map((x) => x.id)).toEqual([n.id]);
    expect((await store.folders.get(sub.id))?.parent).toBeNull();
    expect(await store.undo(token)).toBe(true);
    expect((await store.notes.get(n.id))?.folder).toBe(f.id);
    expect((await store.folders.get(sub.id))?.parent).toBe(f.id);
  });

  it('wipeAll empties every table', async () => {
    const { store, driver } = await makeStore();
    const s = await store.subjects.create({ name: 'Bio', color: '111111' });
    await store.notes.create({ stylePackId: PACK, subject: s.id, document: doc(para('hello')) });
    await store.kv.set('app', 'onboarded', true);
    await store.wipeAll();
    for (const t of ['notes', 'subjects', 'kv', 'searchMap', 'users', 'noteVersions']) {
      expect(driver.raw.prepare(`SELECT count(*) AS c FROM ${t}`).get()).toMatchObject({ c: 0 });
    }
  });
});

describe('settings', () => {
  it('stores validated device settings in kv', async () => {
    const { store } = await makeStore();
    await store.kv.set('app', 'onboarded', true);
    expect(await store.kv.get('app', 'onboarded', z.boolean())).toBe(true);
    expect(await store.kv.get('app', 'onboarded', z.string())).toBeNull(); // wrong shape -> null
    await expect(store.kv.set('Bad NS', 'k', 1)).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(store.kv.set('app', 'big', 'x'.repeat(20_000))).rejects.toMatchObject({ code: 'too_large' });
  });

  it('updates the synced profile settings and keeps unknown keys', async () => {
    const { store, driver } = await makeStore();
    driver.raw.exec(`UPDATE users SET settings = '{"futureKey":1}'`);
    expect(await store.settings.update({ defaultPack: 'clear-read' })).toEqual({ futureKey: 1, defaultPack: 'clear-read' });
    await expect(store.settings.update({ defaultPack: 'no spaces!' })).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('persistence', () => {
  it('reopens a file database with data intact and secure delete on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sn-'));
    try {
      const path = join(dir, 'test.db');
      const a = await makeStore({ path });
      const n = await a.store.notes.create({ stylePackId: PACK, title: 'Keep me' });
      expect(a.driver.raw.prepare('PRAGMA secure_delete').get()).toMatchObject({ secure_delete: 1 });
      expect(a.driver.raw.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
      expect(a.store.info.ftsSecureDelete).toBe(true);
      await a.store.close();
      const b = await makeStore({ path });
      expect((await b.store.notes.get(n.id))?.title).toBe('Keep me');
      await b.store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
