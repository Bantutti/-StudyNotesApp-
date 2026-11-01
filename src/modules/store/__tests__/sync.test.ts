/**
 * Store side of P2b sync (migration 2 + store.sync): change tracking by
 * triggers, applying pulled rows, upload bookkeeping, conflicts, quarantine,
 * cursors, account binding and resets.
 */
import { createLogger, EMPTY_DOC_JSON, memorySink, SAMPLE_NOTE } from '@/core';

import { nodeSqliteDriver } from '../../../../test/nodeSqlite';
import { LATEST_SCHEMA, migrate, MIGRATIONS } from '../migrations';
import { createSqlDb } from '../sql';
import { SYNC_TABLES, TABLE_COLUMNS } from '../sync';
import { UNDO_WINDOW_MS } from '../types';
import { doc, makeStore, para } from './helpers';

const PACK = 'pastel-highlight';
const UID = 'uid-sync-test-0001';

const outbox = async (store: Awaited<ReturnType<typeof makeStore>>['store']) =>
  (await store.sync.listOutbox({ limit: 1000 })).map((i) => `${i.tbl}:${i.id}:${i.seq}`);

describe('migration 2 (sync bookkeeping)', () => {
  it(`is the latest migration and TABLE_COLUMNS matches every synced table`, async () => {
    expect(LATEST_SCHEMA).toBe(2);
    const { driver } = await makeStore();
    for (const t of SYNC_TABLES) {
      const cols = (driver.raw.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name);
      expect([...cols].sort()).toEqual([...TABLE_COLUMNS[t]].sort());
    }
  });

  it('queues every row that existed before the upgrade (guest data uploads on first sign-in)', async () => {
    const driver = nodeSqliteDriver();
    const db = createSqlDb(driver);
    const logger = createLogger({ sink: memorySink(), minLevel: 'debug' });
    await migrate(db, logger, MIGRATIONS.slice(0, 1));
    driver.raw.exec(`INSERT INTO subjects (id, created, updated, name, color, icon) VALUES ('s_0000000000000001', 1, 1, 'Bio', 'AABBCC', 'book')`);
    driver.raw.exec(`INSERT INTO notes (id, created, updated, document, stylePackId) VALUES ('n_0000000000000001', 1, 1, '${EMPTY_DOC_JSON}', 'p')`);
    await migrate(db, logger);
    const rows = driver.raw.prepare('SELECT tbl, id, seq, state FROM syncOutbox ORDER BY tbl').all();
    expect(rows).toEqual([
      { tbl: 'notes', id: 'n_0000000000000001', seq: 1, state: 'pending' },
      { tbl: 'subjects', id: 's_0000000000000001', seq: 1, state: 'pending' },
    ]);
  });
});

describe('change tracking (triggers)', () => {
  it('queues inserts and counts later edits in seq', async () => {
    const { store } = await makeStore();
    expect(await outbox(store)).toEqual(['users:local:1']); // the local profile row
    const s = await store.subjects.create({ name: 'Bio', color: '4F7CF7' });
    await store.subjects.update(s.id, { name: 'Biology' });
    const n = await store.notes.create({ stylePackId: PACK, subject: s.id });
    expect(await outbox(store)).toEqual(['users:local:1', `subjects:${s.id}:2`, `notes:${n.id}:1`]);
    await store.settings.update({ defaultPack: 'clear-read' });
    expect((await store.sync.getOutbox('users', 'local'))?.seq).toBe(2);
  });

  it('queues review logs on insert only', async () => {
    const { store, driver } = await makeStore();
    driver.raw.exec(`INSERT INTO reviewLogs (id, created, card, rating, reviewedAt, device) VALUES ('r_0000000000000001', 1, 'c_0000000000000001', 3, 1, 'd1')`);
    expect(await store.sync.getOutbox('reviewLogs', 'r_0000000000000001')).toMatchObject({ seq: 1 });
    expect(Object.keys(await store.sync.countOutbox())).toEqual(expect.arrayContaining(['reviewLogs']));
  });

  it('queues a delete and the later text wipe (the tombstone must reach the cloud)', async () => {
    const { store, clock } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK });
    await store.sync.markPushed('notes', n.id, { sentSeq: 1, rev: 1, owner: UID });
    expect(await store.sync.getOutbox('notes', n.id)).toBeNull();
    await store.notes.remove([n.id]);
    expect((await store.sync.getOutbox('notes', n.id))?.seq).toBe(1);
    clock.advance(UNDO_WINDOW_MS + 1);
    await store.purge();
    expect((await store.sync.getOutbox('notes', n.id))?.seq).toBe(2);
  });

  it('never queues rows written by applyRemote, and keeps tracking after wipeAll', async () => {
    const { store } = await makeStore();
    await store.sync.applyRemote('subjects', subjectRow('s_remote0000000001', 'Remote'));
    expect(await store.sync.getOutbox('subjects', 's_remote0000000001')).toBeNull();
    expect((await store.sync.getState())).toMatchObject({ uid: null, enabled: false });
    await store.wipeAll();
    expect(await outbox(store)).toEqual([]);
    const s = await store.subjects.create({ name: 'After wipe', color: '4F7CF7' });
    expect(await store.sync.getOutbox('subjects', s.id)).toMatchObject({ seq: 1 });
  });
});

function subjectRow(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, owner: UID, schemaVersion: 1, created: 1000, updated: 2000, rev: 3, deleted: 0, name, color: 'AABBCC',
    icon: 'book', defaultPack: null, defaultTemplate: null, examDates: '[]', aiAllowed: 1, autoMakeCards: 0, ...extra,
  };
}

function noteRow(id: string, document: unknown, extra: Record<string, unknown> = {}) {
  return {
    id, owner: UID, schemaVersion: 1, created: 1000, updated: 2000, rev: 2, deleted: 0, subject: null, folder: null,
    title: 'Pulled', document: JSON.stringify(document), inkLayerRef: null, stylePackId: PACK, templateId: null, tags: '[]', ...extra,
  };
}

describe('applyRemote', () => {
  it('writes a pulled note and makes it searchable', async () => {
    const { store } = await makeStore();
    await store.sync.applyRemote('notes', noteRow('n_remote0000000001', doc(para('mitochondria powerhouse', 'b_remote00000001'))));
    const n = await store.notes.get('n_remote0000000001');
    expect(n).toMatchObject({ title: 'Pulled', rev: 2, owner: UID });
    expect((await store.search('mitochondria')).map((h) => h.noteId)).toEqual(['n_remote0000000001']);
  });

  it('a pulled tombstone removes search rows and local versions', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK, document: SAMPLE_NOTE });
    await store.versions.snapshot(n.id, 'edit');
    expect(await store.versions.list(n.id)).toHaveLength(1);
    await store.sync.applyRemote('notes', noteRow(n.id, { type: 'doc', content: [] }, { deleted: 1, title: '' }));
    expect(await store.versions.list(n.id)).toHaveLength(0);
    expect(await store.search('osmosis')).toEqual([]);
  });

  it('rejects unknown columns, local-only columns and non-scalar values', async () => {
    const { store } = await makeStore();
    await expect(store.sync.applyRemote('subjects', { ...subjectRow('s_x000000000000001', 'X'), evil: 1 })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      store.sync.applyRemote('assets', { id: 'a_x000000000000001', owner: UID, schemaVersion: 1, created: 1, updated: 1, rev: 1, deleted: 0, type: 'audio', cloudPath: null, size: 1, localPath: '/etc/passwd' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(store.sync.applyRemote('subjects', subjectRow('s_x000000000000001', 'X', { examDates: [1] }))).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await store.subjects.get('s_x000000000000001')).toBeNull();
  });

  it('keeps a local asset path when the asset doc is pulled again', async () => {
    const { store, driver } = await makeStore();
    driver.raw.exec(`INSERT INTO assets (id, created, updated, type, size, localPath) VALUES ('a_0000000000000001', 1, 1, 'audio', 5, 'file:///rec.m4a')`);
    await store.sync.applyRemote('assets', { id: 'a_0000000000000001', owner: UID, schemaVersion: 1, created: 1, updated: 9, rev: 2, deleted: 0, type: 'audio', cloudPath: null, size: 5 });
    expect(driver.raw.prepare('SELECT localPath, rev FROM assets').get()).toEqual({ localPath: 'file:///rec.m4a', rev: 2 });
  });
});

describe('upload bookkeeping', () => {
  it('markPushed clears the item only if nothing was edited after it was sent', async () => {
    const { store } = await makeStore();
    const s = await store.subjects.create({ name: 'A', color: '4F7CF7' });
    await store.sync.markSent('subjects', s.id, { seq: 1, rev: 1, hash: 'h1' });
    await store.subjects.update(s.id, { name: 'B' }); // edit while the upload is in flight
    await store.sync.markPushed('subjects', s.id, { sentSeq: 1, rev: 1, owner: UID });
    expect(await store.sync.getOutbox('subjects', s.id)).toMatchObject({ seq: 2, sentSeq: null, state: 'pending' });
    expect(await store.subjects.get(s.id)).toMatchObject({ rev: 1, owner: UID, name: 'B' });
    await store.sync.markPushed('subjects', s.id, { sentSeq: 2, rev: 2, owner: UID });
    expect(await store.sync.getOutbox('subjects', s.id)).toBeNull();
  });

  it('quarantines a bad upload and retries it after the next edit', async () => {
    const { store } = await makeStore();
    const s = await store.subjects.create({ name: 'A', color: '4F7CF7' });
    await store.sync.quarantine({ tbl: 'subjects', id: s.id, direction: 'out', reason: 'schema' });
    expect(await store.sync.listOutbox()).toEqual([expect.objectContaining({ tbl: 'users' })]);
    expect(await store.sync.listQuarantine()).toEqual([expect.objectContaining({ id: s.id, direction: 'out', reason: 'schema' })]);
    await store.subjects.update(s.id, { name: 'B' });
    expect(await store.sync.getOutbox('subjects', s.id)).toMatchObject({ state: 'pending' });
  });

  it('lists uploads users first, then by table order', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK });
    const s = await store.subjects.create({ name: 'A', color: '4F7CF7' });
    expect((await store.sync.listOutbox()).map((i) => i.id)).toEqual(['local', s.id, n.id]);
  });
});

describe('conflicts', () => {
  it('stores the server copy, pauses the upload and keeps it paused through local edits', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK, title: 'Mine' });
    const server = noteRow(n.id, doc(para('theirs', 'b_theirs00000001')), { rev: 4, title: 'Theirs' });
    await store.sync.putConflict({ tbl: 'notes', id: n.id, kind: 'edit_edit', serverRev: 4, serverRow: server });
    expect(await store.sync.getOutbox('notes', n.id)).toMatchObject({ state: 'conflict' });
    await store.notes.save(n.id, { title: 'Mine 2' });
    expect(await store.sync.getOutbox('notes', n.id)).toMatchObject({ state: 'conflict', seq: 2 });
    const [c] = await store.sync.listConflicts();
    expect(c).toMatchObject({ tbl: 'notes', id: n.id, kind: 'edit_edit', serverRev: 4 });
    expect(c?.serverRow.title).toBe('Theirs');
    expect(await store.sync.countConflicts()).toBe(1);
    await store.sync.removeConflict('notes', n.id);
    expect(await store.sync.countConflicts()).toBe(0);
  });

  it('keep both: inserts my version as a new, queued note', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK, title: 'Mine', document: SAMPLE_NOTE });
    const mine = await store.sync.readRow('notes', n.id);
    await store.sync.insertNoteCopy(mine!, 'n_copy000000000001', 'Mine (copy from this phone)');
    expect(await store.notes.get('n_copy000000000001')).toMatchObject({ title: 'Mine (copy from this phone)', rev: 0, owner: null });
    expect(await store.sync.getOutbox('notes', 'n_copy000000000001')).toMatchObject({ state: 'pending' });
    expect((await store.search('osmosis')).length).toBe(2);
  });

  it('snapshots a row as a "Before sync merge" version', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: PACK, document: SAMPLE_NOTE });
    const server = noteRow(n.id, doc(para('theirs', 'b_theirs00000001')), { title: 'Theirs' });
    expect(await store.sync.snapshotRow(server, 'v_0000000000000901')).toBe(true);
    expect(await store.versions.list(n.id)).toEqual([expect.objectContaining({ reason: 'before_sync_merge', title: 'Theirs' })]);
    expect(await store.sync.snapshotRow({ ...server, deleted: 1 }, 'v_0000000000000902')).toBe(false);
  });
});

describe('account binding and resets', () => {
  it('binds once and refuses another account (Q7)', async () => {
    const { store } = await makeStore();
    await store.sync.bind(UID);
    await store.sync.bind(UID);
    await expect(store.sync.bind('someone-else')).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('resetToGuest clears owners, revs and sync state and re-queues every row', async () => {
    const { store } = await makeStore();
    await store.sync.bind(UID);
    await store.sync.setEnabled(true);
    const s = await store.subjects.create({ name: 'A', color: '4F7CF7' });
    await store.sync.markPushed('subjects', s.id, { sentSeq: 1, rev: 1, owner: UID });
    await store.sync.setCursor('subjects', { seconds: 5, nanos: 6, docId: s.id });
    await store.sync.resetToGuest();
    expect(await store.subjects.get(s.id)).toMatchObject({ owner: null, rev: 0 });
    expect(await store.sync.getState()).toMatchObject({ uid: null, enabled: false });
    expect(await store.sync.getCursor('subjects')).toBeNull();
    expect((await store.sync.listOutbox()).map((i) => i.id)).toEqual(['local', s.id]);
  });

  it('stores exact pull cursors', async () => {
    const { store } = await makeStore();
    await store.sync.setCursor('notes', { seconds: 1_800_000_000, nanos: 123_456_000, docId: 'n_1' });
    expect(await store.sync.getCursor('notes')).toEqual({ seconds: 1_800_000_000, nanos: 123_456_000, docId: 'n_1' });
  });

  it('run() groups calls in one transaction (all or nothing)', async () => {
    const { store } = await makeStore();
    await expect(
      store.sync.run(async (s) => {
        await s.bind(UID);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await store.sync.getState()).uid).toBeNull();
  });
});
