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
