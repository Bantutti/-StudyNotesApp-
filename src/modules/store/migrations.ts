/**
 * Numbered schema migrations (decision Q4).
 *
 * - PRAGMA user_version holds the last applied migration number.
 * - Each migration runs in one transaction together with its user_version
 *   bump, so a crash leaves the database at the previous version.
 * - A database newer than this app (user_version > latest) is refused
 *   instead of being "fixed" by old code.
 * - Migrations are append-only: never edit a shipped migration; add one.
 *
 * Synced tables copy P2a's cloud documents field for field
 * (firebase/src/schemas/collections.ts), so P2b's sync is a straight copy:
 *   - column names = cloud field names (camelCase)
 *   - timestamps = integer milliseconds (cloud Timestamp <-> ms in P2b)
 *   - booleans = 0/1, lists and JSON strings = TEXT holding JSON
 *   - owner = NULL while in guest mode; rev = 0 means "never uploaded"
 * Local-only extras are marked "local only". There are no foreign keys
 * between synced tables, because sync may deliver docs in any order.
 */
import { AppError, type Logger } from '@/core';

import type { SqlDb } from './sql';

export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

/** Lifecycle columns on every synced, mutable doc (P2a §D.3). */
const META = `
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT,
  schemaVersion INTEGER NOT NULL DEFAULT 1,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0 CHECK (rev >= 0),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))`;

const bool = (col: string, dflt: 0 | 1) => `${col} INTEGER NOT NULL DEFAULT ${dflt} CHECK (${col} IN (0, 1))`;

/**
 * The 10 synced tables, in upload order (users first: the cloud profile must
 * exist before anything else is written, P2a §D.3 "Profile first").
 * Fixed identifiers, never user data.
 */
export const SYNC_TABLES = [
  'users', 'subjects', 'folders', 'notes', 'cards', 'reviewLogs', 'recordings', 'assets', 'stylePacks', 'templates',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

const tableList = SYNC_TABLES.map((t) => `'${t}'`).join(', ');

/** "Not applying a pulled doc": local edits only are queued (§ sync.md "Change tracking"). */
const LOCAL_EDIT = 'COALESCE((SELECT applying FROM syncState WHERE id = 1), 0) = 0';

/**
 * Queues (table, id) in the outbox. seq counts local edits since the last
 * upload, so an edit made while an upload is in flight is never lost
 * (markPushed only clears the item if seq is still the one it sent).
 * A quarantined item (invalid local data) is retried after the next edit.
 */
const enqueue = (t: SyncTable) => `INSERT INTO syncOutbox (tbl, id, seq) VALUES ('${t}', NEW.id, 1)
      ON CONFLICT (tbl, id) DO UPDATE SET seq = seq + 1,
        state = CASE WHEN state = 'quarantined' THEN 'pending' ELSE state END;`;

const triggersFor = (t: SyncTable): string[] => {
  const ins = `CREATE TRIGGER sync_${t}_ins AFTER INSERT ON ${t} WHEN ${LOCAL_EDIT} BEGIN ${enqueue(t)} END`;
  // Review logs are append-only (P2a reviewLogSchema): only inserts are queued.
  if (t === 'reviewLogs') return [ins];
  return [ins, `CREATE TRIGGER sync_${t}_upd AFTER UPDATE ON ${t} WHEN ${LOCAL_EDIT} BEGIN ${enqueue(t)} END`];
};

/**
 * Migration 2 (P2b). Local only: none of these tables is ever synced.
 * - syncState: one row. The account this database is bound to (decision
 *   Q7: one account per local database), whether sync is on, and the
 *   `applying` flag the triggers read (1 while a pulled doc is written, so
 *   remote changes are not queued for upload again).
 * - syncOutbox: what still has to be uploaded (filled by triggers, Q2).
 *   There is NO delete trigger: removing rows on the phone (Delete all data,
 *   Remove notes from this phone) never deletes anything in the cloud.
 * - syncCursors: pull position per collection, as the exact server
 *   timestamp (seconds + nanos: Firestore keeps microseconds, P1 keeps ms)
 *   plus the doc id for ties.
 * - syncConflicts: the server copy of a doc whose upload was rejected as
 *   stale (rev), until the user resolves it (Q5). Holds note content, so it
 *   is wiped by Delete all data, Remove notes from this phone and resolve.
 * - syncQuarantine: docs that failed validation (ids and a reason code
 *   only, never content), in either direction.
 * - syncFiles: for each asset whose file this device holds, the hash, the
 *   asset doc rev and the cloud path of the last uploaded or downloaded
 *   version (sync/assets.ts).
 * Every existing row is queued once, so guest data uploads on first sign-in.
 */
const SYNC_MIGRATION: readonly string[] = [
  `CREATE TABLE syncState (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    uid TEXT,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    applying INTEGER NOT NULL DEFAULT 0 CHECK (applying IN (0, 1)),
    initialSyncDone INTEGER NOT NULL DEFAULT 0 CHECK (initialSyncDone IN (0, 1)),
    lastPushAt INTEGER,
    lastPullAt INTEGER,
    lastError TEXT
  ) STRICT`,
  'INSERT INTO syncState (id) VALUES (1)',
  `CREATE TABLE syncOutbox (
    tbl TEXT NOT NULL CHECK (tbl IN (${tableList})),
    id TEXT NOT NULL,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'conflict', 'quarantined')),
    sentSeq INTEGER,
    sentRev INTEGER,
    sentHash TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tbl, id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE syncCursors (
    tbl TEXT PRIMARY KEY NOT NULL CHECK (tbl IN (${tableList})),
    seconds INTEGER NOT NULL,
    nanos INTEGER NOT NULL CHECK (nanos BETWEEN 0 AND 999999999),
    docId TEXT NOT NULL
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE syncConflicts (
    tbl TEXT NOT NULL CHECK (tbl IN (${tableList})),
    id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('edit_edit', 'remote_deleted', 'local_deleted')),
    serverRev INTEGER NOT NULL,
    serverRow TEXT NOT NULL,
    detected INTEGER NOT NULL,
    PRIMARY KEY (tbl, id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE syncQuarantine (
    tbl TEXT NOT NULL CHECK (tbl IN (${tableList})),
    id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    reason TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (tbl, id, direction)
  ) STRICT, WITHOUT ROWID`,
  // Files behind asset docs (audio, images, ink, pdf): the version of the
  // file this device holds, so the asset pass knows what changed where.
  `CREATE TABLE syncFiles (
    id TEXT PRIMARY KEY NOT NULL,
    syncedHash TEXT NOT NULL,
    syncedRev INTEGER NOT NULL,
    syncedPath TEXT NOT NULL
  ) STRICT, WITHOUT ROWID`,
  ...SYNC_TABLES.flatMap(triggersFor),
  ...SYNC_TABLES.map((t) => `INSERT INTO syncOutbox (tbl, id, seq) SELECT '${t}', id, 1 FROM ${t}`),
];

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema (P1)',
    statements: [
      // users/{uid}: one local row ('local' while guest). Email is never stored (P2a §D.2).
      `CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        owner TEXT,
        schemaVersion INTEGER NOT NULL DEFAULT 1,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        rev INTEGER NOT NULL DEFAULT 0 CHECK (rev >= 0),
        settings TEXT NOT NULL DEFAULT '{}',
        deletionRequestedAt INTEGER
      ) STRICT`,
      `CREATE TABLE subjects (${META},
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        defaultPack TEXT,
        defaultTemplate TEXT,
        examDates TEXT NOT NULL DEFAULT '[]',
        ${bool('aiAllowed', 1)},
        ${bool('autoMakeCards', 0)}
      ) STRICT`,
      `CREATE TABLE folders (${META},
        subject TEXT,
        name TEXT NOT NULL,
        parent TEXT
      ) STRICT`,
      `CREATE TABLE notes (${META},
        subject TEXT,
        folder TEXT,
        title TEXT NOT NULL DEFAULT '',
        document TEXT NOT NULL,
        inkLayerRef TEXT,
        stylePackId TEXT NOT NULL,
        templateId TEXT,
        tags TEXT NOT NULL DEFAULT '[]'
      ) STRICT`,
      `CREATE TABLE cards (${META},
        subject TEXT,
        note TEXT,
        sourceBlockId TEXT,
        type TEXT NOT NULL CHECK (type IN ('basic', 'reversed', 'cloze')),
        front TEXT NOT NULL,
        back TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK (source IN ('definition', 'highlight', 'bookmark', 'ai', 'manual')),
        ${bool('sourceChanged', 0)},
        ${bool('suspended', 0)}
      ) STRICT`,
      // Append-only: no updated, rev or deleted (P2a reviewLogSchema).
      `CREATE TABLE reviewLogs (
        id TEXT PRIMARY KEY NOT NULL,
        owner TEXT,
        schemaVersion INTEGER NOT NULL DEFAULT 1,
        created INTEGER NOT NULL,
        card TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
        reviewedAt INTEGER NOT NULL,
        device TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE recordings (${META},
        note TEXT NOT NULL,
        asset TEXT,
        duration INTEGER NOT NULL DEFAULT 0,
        language TEXT,
        segments TEXT NOT NULL DEFAULT '[]',
        bookmarks TEXT NOT NULL DEFAULT '[]'
      ) STRICT`,
      `CREATE TABLE assets (${META},
        type TEXT NOT NULL CHECK (type IN ('audio', 'image', 'sticker', 'ink', 'pdf')),
        cloudPath TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        localPath TEXT -- local only: a device file path is never synced (P2a §D.2)
      ) STRICT`,
      `CREATE TABLE stylePacks (${META},
        version INTEGER NOT NULL,
        definition TEXT NOT NULL,
        ${bool('createdFromReference', 0)}
      ) STRICT`,
      `CREATE TABLE templates (${META},
        version INTEGER NOT NULL,
        definition TEXT NOT NULL
      ) STRICT`,

      // ---- local only -------------------------------------------------
      // Version history (plan F14): never synced, wiped with its note.
      `CREATE TABLE noteVersions (
        id TEXT PRIMARY KEY NOT NULL,
        note TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        created INTEGER NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('edit', 'leave', 'before_beautify', 'before_pack',
          'before_template', 'before_restore', 'before_ai', 'before_sync_merge')),
        title TEXT NOT NULL,
        stylePackId TEXT NOT NULL,
        document TEXT NOT NULL,
        hash TEXT NOT NULL
      ) STRICT`,
      // Namespaced key-value settings (device flags, P3b usage meter, ...).
      `CREATE TABLE kv (
        ns TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated INTEGER NOT NULL,
        PRIMARY KEY (ns, key)
      ) STRICT, WITHOUT ROWID`,
      // Full-text search, one row per text block (decision Q10).
      // searchMap holds the row's note and block; search holds only text.
      `CREATE TABLE searchMap (
        rowid INTEGER PRIMARY KEY,
        noteId TEXT NOT NULL,
        blockId TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('title', 'heading', 'term', 'text'))
      ) STRICT`,
      `CREATE VIRTUAL TABLE search USING fts5(
        text,
        tokenize = 'unicode61 remove_diacritics 2',
        prefix = '2 3'
      )`,

      // ---- indexes ----------------------------------------------------
      'CREATE INDEX subjects_live ON subjects (deleted, name)',
      'CREATE INDEX folders_subject ON folders (subject, deleted)',
      'CREATE INDEX notes_subject ON notes (subject, deleted, updated)',
      'CREATE INDEX notes_folder ON notes (folder, deleted)',
      'CREATE INDEX notes_updated ON notes (deleted, updated)',
      'CREATE INDEX cards_note ON cards (note)',
      'CREATE INDEX reviewLogs_card ON reviewLogs (card, reviewedAt)',
      'CREATE INDEX recordings_note ON recordings (note)',
      'CREATE INDEX noteVersions_note ON noteVersions (note, created)',
      'CREATE INDEX searchMap_note ON searchMap (noteId)',
    ],
  },
  {
    version: 2,
    name: 'sync bookkeeping (P2b)',
    statements: SYNC_MIGRATION,
  },
];

export const LATEST_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/** Throws if the list is not 1, 2, 3, ... in order (a build bug). */
export function assertMigrationOrder(list: readonly Migration[]): void {
  list.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migration_order:${m.version}`);
  });
}

export async function getUserVersion(db: SqlDb): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  return Number(row?.user_version ?? 0);
}

/** Applies pending migrations. Returns the versions before and after. */
export async function migrate(
  db: SqlDb,
  logger: Logger,
  list: readonly Migration[] = MIGRATIONS,
): Promise<{ from: number; to: number }> {
  assertMigrationOrder(list);
  const latest = list.length;
  const from = await getUserVersion(db);
  if (from > latest) {
    logger.error('store.schema_too_new', { from, latest });
    throw new AppError('unsupported', 'Your notes were saved by a newer version of the app. Please update the app.');
  }
  for (const m of list.slice(from)) {
    await db.transaction(async (tx) => {
      for (const sql of m.statements) await tx.exec(sql);
      // m.version is an integer from code (asserted above), never user data.
      await tx.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`);
    });
    logger.info('store.migrated', { version: m.version });
  }
  return { from, to: latest };
}
