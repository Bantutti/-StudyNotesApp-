import { createLogger, memorySink } from '@/core';

import { nodeSqliteDriver } from '../../../../test/nodeSqlite';
import { assertMigrationOrder, getUserVersion, LATEST_SCHEMA, migrate, MIGRATIONS, type Migration } from '../migrations';
import { createSqlDb } from '../sql';

const logger = createLogger({ sink: memorySink(), minLevel: 'debug' });

/**
 * The 1:1 contract with P2a (firebase/src/schemas/collections.ts, read on
 * Nov 1 2026). Synced tables must have exactly these columns, so P2b can copy
 * rows to cloud docs field by field. Local-only extras are listed separately.
 */
const CLOUD_FIELDS: Record<string, string[]> = {
  users: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'settings', 'deletionRequestedAt'],
  subjects: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'name', 'color', 'icon',
    'defaultPack', 'defaultTemplate', 'examDates', 'aiAllowed', 'autoMakeCards'],
  folders: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'subject', 'name', 'parent'],
  notes: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'subject', 'folder', 'title',
    'document', 'inkLayerRef', 'stylePackId', 'templateId', 'tags'],
  cards: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'subject', 'note', 'sourceBlockId',
    'type', 'front', 'back', 'source', 'sourceChanged', 'suspended'],
  reviewLogs: ['id', 'owner', 'schemaVersion', 'created', 'card', 'rating', 'reviewedAt', 'device'],
  recordings: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'note', 'asset', 'duration',
    'language', 'segments', 'bookmarks'],
  assets: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'type', 'cloudPath', 'size'],
  stylePacks: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'version', 'definition',
    'createdFromReference'],
  templates: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'version', 'definition'],
};
const LOCAL_ONLY_COLUMNS: Record<string, string[]> = { assets: ['localPath'] };

async function freshDb() {
  const db = createSqlDb(nodeSqliteDriver());
  await migrate(db, logger);
  return db;
}

describe('migrations', () => {
  it('creates every cloud table with exactly the P2a field names', async () => {
    const db = await freshDb();
    for (const [table, fields] of Object.entries(CLOUD_FIELDS)) {
      const cols = (await db.all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)).map((c) => c.name);
      expect(cols.sort()).toEqual([...fields, ...(LOCAL_ONLY_COLUMNS[table] ?? [])].sort());
    }
  });

  it('creates the local-only tables and the FTS index', async () => {
    const db = await freshDb();
    const names = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['noteVersions', 'kv', 'searchMap', 'search']));
    expect(await getUserVersion(db)).toBe(LATEST_SCHEMA);
  });

  it('is idempotent', async () => {
    const db = await freshDb();
    expect(await migrate(db, logger)).toEqual({ from: LATEST_SCHEMA, to: LATEST_SCHEMA });
  });

  it('refuses a database written by a newer app version', async () => {
    const db = createSqlDb(nodeSqliteDriver());
    await db.exec('PRAGMA user_version = 99');
    await expect(migrate(db, logger)).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('rolls back a failing migration completely', async () => {
    const db = await freshDb();
    const bad: Migration[] = [
      ...MIGRATIONS,
      { version: LATEST_SCHEMA + 1, name: 'broken', statements: ['CREATE TABLE extra (x TEXT)', 'THIS IS NOT SQL'] },
    ];
    await expect(migrate(db, logger, bad)).rejects.toThrow();
    expect(await getUserVersion(db)).toBe(LATEST_SCHEMA);
    expect(await db.get("SELECT name FROM sqlite_master WHERE name = 'extra'")).toBeNull();
  });

  it('applies a later migration on top of existing data', async () => {
    const db = await freshDb();
    await db.run("INSERT INTO kv (ns, key, value, updated) VALUES ('t', 'k', '1', 1)");
    const next: Migration[] = [...MIGRATIONS, { version: LATEST_SCHEMA + 1, name: 'add', statements: ['CREATE TABLE extra (x TEXT)'] }];
    expect(await migrate(db, logger, next)).toEqual({ from: LATEST_SCHEMA, to: LATEST_SCHEMA + 1 });
    expect(await db.get("SELECT value FROM kv WHERE ns = 't'")).toEqual({ value: '1' });
  });

  it('rejects gaps or reordering in the migration list', () => {
    expect(() => assertMigrationOrder([{ version: 2, name: 'x', statements: [] }])).toThrow('migration_order');
  });

  it('enforces column types and enums (STRICT tables, CHECKs)', async () => {
    const db = await freshDb();
    await expect(
      db.run("INSERT INTO cards (id, created, updated, type, front, source) VALUES ('c_00000000000000001', 1, 1, 'weird', 'f', 'manual')"),
    ).rejects.toThrow();
    await expect(
      db.run("INSERT INTO reviewLogs (id, created, card, rating, reviewedAt, device) VALUES ('r_00000000000000001', 1, 'c', 5, 1, 'd')"),
    ).rejects.toThrow();
    await expect(db.run("INSERT INTO notes (id, created, updated, document, stylePackId) VALUES ('x', 'not a number', 1, '{}', 'p')")).rejects.toThrow();
  });
});

describe('SqlDb', () => {
  it('rolls back a failed transaction', async () => {
    const db = await freshDb();
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO kv (ns, key, value, updated) VALUES ('t', 'a', '1', 1)");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.get("SELECT * FROM kv WHERE ns = 't'")).toBeNull();
  });

  it('rolls back only the inner savepoint when a nested transaction fails', async () => {
    const db = await freshDb();
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO kv (ns, key, value, updated) VALUES ('t', 'outer', '1', 1)");
      await expect(
        tx.transaction(async (inner) => {
          await inner.run("INSERT INTO kv (ns, key, value, updated) VALUES ('t', 'inner', '1', 1)");
          throw new Error('inner');
        }),
      ).rejects.toThrow('inner');
    });
    expect((await db.all("SELECT key FROM kv WHERE ns = 't'")).map((r) => r.key)).toEqual(['outer']);
  });

  it('never interleaves concurrent transactions', async () => {
    const db = await freshDb();
    await db.run("INSERT INTO kv (ns, key, value, updated) VALUES ('t', 'n', '0', 1)");
    await Promise.all(
      Array.from({ length: 40 }, () =>
        db.transaction(async (tx) => {
          const r = await tx.get<{ value: string }>("SELECT value FROM kv WHERE ns = 't' AND key = 'n'");
          await new Promise((res) => setTimeout(res, 0)); // yield mid-transaction
          await tx.run("UPDATE kv SET value = ? WHERE ns = 't' AND key = 'n'", [String(Number(r?.value) + 1)]);
        }),
      ),
    );
    expect(await db.get("SELECT value FROM kv WHERE ns = 't'")).toEqual({ value: '40' });
  });

  it('keeps working after a failed statement and refuses use after close', async () => {
    const db = await freshDb();
    await expect(db.exec('NOT SQL')).rejects.toThrow();
    expect(await db.get('SELECT 1 AS one')).toEqual({ one: 1 });
    await db.close();
    await expect(db.get('SELECT 1')).rejects.toThrow('db_closed');
  });
});
