/**
 * The Store: the app's single entry point to local data.
 *
 * Every write runs in one transaction (note + search rows + version, or a
 * whole subject delete). Screens never see SQL or transaction handles.
 */
import type { ZodType } from 'zod';

import { AppError, type IdGenerator, type Logger, type NoteDoc } from '@/core';

import { migrate } from './migrations';
import { createNotesRepo, type CreateNoteInput, type NotePatch, type SaveResult } from './notes';
import { inList, str } from './rows';
import { searchNotes } from './search';
import { createKvRepo, createProfileRepo, type UserSettings } from './settings';
import { createSqlDb, type SqlDriver, type SqlExecutor } from './sql';
import { createFoldersRepo, createSubjectsRepo, WIPED_NAME, type CreateSubjectInput, type SubjectPatch } from './subjects';
import {
  UNDO_WINDOW_MS,
  type Folder,
  type Note,
  type NoteListItem,
  type NoteScope,
  type NoteSort,
  type SearchHit,
  type Subject,
  type UndoToken,
  type Version,
  type VersionMeta,
  type VersionReason,
} from './types';
import { createSyncRepo, type SyncRepo } from './sync';
import { createVersionsRepo } from './versions';

/**
 * The sync repo with every method bound to its own transaction (or, inside
 * store.sync.run, to the shared one). Sync writes must always run inside a
 * transaction: the "applying" flag pauses the outbox triggers, and a user
 * edit must never slip in while it is set.
 */
type BoundSync = {
  [K in Exclude<keyof SyncRepo, 'applying'>]: SyncRepo[K] extends (ex: SqlExecutor, ...a: infer A) => infer R ? (...a: A) => R : never;
};

function bindSync(repo: SyncRepo, run: <T>(fn: (ex: SqlExecutor) => Promise<T>) => Promise<T>): BoundSync {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(repo)) {
    if (k === 'applying' || typeof f !== 'function') continue;
    out[k] = (...a: unknown[]) => run((ex) => (f as (ex: SqlExecutor, ...rest: unknown[]) => Promise<unknown>)(ex, ...a));
  }
  return out as BoundSync;
}

export interface StoreDeps {
  ids: IdGenerator;
  logger: Logger;
  now?: () => number;
}

export interface StoreInfo {
  schemaVersion: number;
  /** FTS5 secure-delete (SQLite 3.44+): deleted search text is overwritten. */
  ftsSecureDelete: boolean;
}

/** Tables wiped by "Delete all data" (children first). */
const ALL_TABLES = [
  'noteVersions', 'searchMap', 'search', 'kv', 'reviewLogs', 'cards', 'recordings', 'notes', 'folders',
  'subjects', 'assets', 'stylePacks', 'templates', 'users',
  // P2b sync bookkeeping (syncState is reset, not deleted: the triggers read it).
  'syncOutbox', 'syncCursors', 'syncConflicts', 'syncQuarantine', 'syncFiles',
] as const;

export async function openStore(driver: SqlDriver, deps: StoreDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.logger.child('store');
  const db = createSqlDb(driver);

  // Per-connection settings (cannot run inside a transaction).
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec('PRAGMA secure_delete = ON');
  await db.exec('PRAGMA busy_timeout = 3000');

  const { to } = await migrate(db, log);

  let ftsSecureDelete = true;
  try {
    await db.exec("INSERT INTO search (search, rank) VALUES ('secure-delete', 1)");
  } catch {
    ftsSecureDelete = false;
    log.warn('fts_secure_delete_unavailable');
  }

  const rd = { ids: deps.ids, now };
  const subjects = createSubjectsRepo(rd);
  const folders = createFoldersRepo(rd);
  const notes = createNotesRepo(rd);
  const versions = createVersionsRepo(rd);
  const kv = createKvRepo({ now, logger: log });
  const profile = createProfileRepo({ now, logger: log });
  const syncRepo = createSyncRepo({ now });

  await profile.ensure(db);

  /**
   * Wipes deleted text. `immediate` skips the undo window (app going to the background).
   * secure_delete zeroes freed pages, but in WAL mode the old page images stay in the -wal
   * file until a checkpoint, so a purge that removed anything checkpoints and truncates it.
   */
  const purge = async (immediate = false): Promise<number> => {
    const cutoff = immediate ? now() : now() - UNDO_WINDOW_MS;
    const count = await db.transaction(async (tx) => {
      const n = await notes.purgeDeleted(tx, cutoff);
      const s = await subjects.purgeDeleted(tx, cutoff);
      const f = await folders.purgeDeleted(tx, cutoff);
      return n + s + f;
    });
    if (count > 0) {
      try {
        await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch {
        log.warn('wal_checkpoint_failed'); // busy reader: SQLite checkpoints again later
      }
    }
    return count;
  };
  const purged = await purge();
  if (purged) log.info('purged_on_open', { count: purged });

  const ids = (rows: Record<string, unknown>[]) => rows.map((r) => str(r.id));

  const store = {
    info: { schemaVersion: to, ftsSecureDelete } as StoreInfo,

    subjects: {
      list: (): Promise<Subject[]> => subjects.list(db),
      get: (id: string) => subjects.get(db, id),
      create: (input: CreateSubjectInput) => db.transaction((tx) => subjects.create(tx, input)),
      update: (id: string, patch: SubjectPatch) => db.transaction((tx) => subjects.update(tx, id, patch)),
      /**
       * Deletes a subject. mode 'move': its folders and notes go to the Inbox.
       * mode 'delete': they are deleted too (wiped after the undo window).
       */
      remove: (id: string, mode: 'move' | 'delete'): Promise<UndoToken> =>
        db.transaction(async (tx) => {
          const cur = await subjects.get(tx, id);
          if (!cur || cur.deleted) throw new AppError('not_found', 'That subject no longer exists.');
          const noteIds = ids(await tx.all('SELECT id FROM notes WHERE subject = ? AND deleted = 0', [id]));
          const folderIds = ids(await tx.all('SELECT id FROM folders WHERE subject = ? AND deleted = 0', [id]));
          const t = now();
          if (mode === 'move') {
            if (noteIds.length) await tx.run(`UPDATE notes SET subject = NULL, updated = ? WHERE id IN ${inList(noteIds)}`, [t, ...noteIds]);
            if (folderIds.length) await tx.run(`UPDATE folders SET subject = NULL, updated = ? WHERE id IN ${inList(folderIds)}`, [t, ...folderIds]);
          } else {
            await notes.softDelete(tx, noteIds, t);
            for (const f of folderIds) await folders.setDeleted(tx, f, true);
          }
          await subjects.setDeleted(tx, id, true);
          return { kind: 'subject', at: t, subjectId: id, mode, noteIds, folderIds };
        }),
    },

    folders: {
      list: (subjectId: string | null): Promise<Folder[]> => folders.list(db, subjectId),
      get: (id: string) => folders.get(db, id),
      create: (input: { subject: string | null; name: string; parent?: string | null }) =>
        db.transaction((tx) => folders.create(tx, input)),
      rename: (id: string, name: string) => db.transaction((tx) => folders.rename(tx, id, name)),
      /** Deletes a folder; its notes move up to the subject, sub-folders move up a level. */
      remove: (id: string): Promise<UndoToken> =>
        db.transaction(async (tx) => {
          const cur = await folders.get(tx, id);
          if (!cur || cur.deleted) throw new AppError('not_found', 'That folder no longer exists.');
          const t = now();
          const noteIds = ids(await tx.all('SELECT id FROM notes WHERE folder = ? AND deleted = 0', [id]));
          const childFolderIds = ids(await tx.all('SELECT id FROM folders WHERE parent = ? AND deleted = 0', [id]));
          if (noteIds.length) await tx.run(`UPDATE notes SET folder = NULL, updated = ? WHERE id IN ${inList(noteIds)}`, [t, ...noteIds]);
          if (childFolderIds.length) {
            await tx.run(`UPDATE folders SET parent = NULL, updated = ? WHERE id IN ${inList(childFolderIds)}`, [t, ...childFolderIds]);
          }
          await folders.setDeleted(tx, id, true);
          return { kind: 'folder', at: t, folderId: id, noteIds, childFolderIds };
        }),
    },

    notes: {
      get: (id: string): Promise<Note | null> => notes.get(db, id),
      list: (scope: NoteScope, opts?: { sort?: NoteSort; tag?: string; limit?: number }): Promise<NoteListItem[]> =>
        notes.list(db, scope, opts),
      recent: (limit = 10) => notes.list(db, { scope: 'all' }, { sort: 'updated', limit }),
      counts: () => notes.countBySubject(db),
      tags: (subjectId?: string) => notes.tags(db, subjectId),
      create: (input: CreateNoteInput): Promise<Note> => db.transaction((tx) => notes.create(tx, input)),
      /**
       * Saves changes. `before` saves a version of the CURRENT state first,
       * in the same transaction (e.g. 'before_pack' when switching packs).
       */
      save: (id: string, patch: NotePatch, opts: { before?: VersionReason } = {}): Promise<SaveResult> =>
        db.transaction(async (tx) => {
          if (opts.before) await versions.snapshot(tx, id, opts.before);
          return notes.save(tx, id, patch);
        }),
      remove: (noteIds: readonly string[]): Promise<UndoToken> =>
        db.transaction(async (tx) => {
          const at = now();
          return { kind: 'notes', at, noteIds: await notes.softDelete(tx, noteIds, at) };
        }),
    },

    versions: {
      list: (noteId: string): Promise<VersionMeta[]> => versions.list(db, noteId),
      get: (id: string): Promise<Version | null> => versions.get(db, id),
      latestAt: (noteId: string) => versions.latestAt(db, noteId),
      snapshot: (noteId: string, reason: VersionReason) => db.transaction((tx) => versions.snapshot(tx, noteId, reason)),
      /** Restores a version: saves "Before restore" first, then brings back its exact document, title and pack. */
      restore: (noteId: string, versionId: string): Promise<SaveResult & { document: NoteDoc }> =>
        db.transaction(async (tx) => {
          const v = await versions.get(tx, versionId);
          if (!v || v.note !== noteId) throw new AppError('not_found', 'That version no longer exists.');
          await versions.snapshot(tx, noteId, 'before_restore');
          const r = await notes.save(tx, noteId, { document: v.document, title: v.title, stylePackId: v.stylePackId });
          return { ...r, document: v.document };
        }),
    },

    search: (text: string): Promise<SearchHit[]> => searchNotes(db, text),

    kv: {
      get: <T>(ns: string, key: string, schema: ZodType<T>) => kv.get(db, ns, key, schema),
      set: (ns: string, key: string, value: unknown) => kv.set(db, ns, key, value),
      remove: (ns: string, key: string) => kv.remove(db, ns, key),
    },

    settings: {
      get: (): Promise<UserSettings> => profile.getSettings(db),
      update: (patch: Partial<UserSettings>) => db.transaction((tx) => profile.updateSettings(tx, patch)),
    },

    /** Reverses a delete if its text has not been wiped yet. Returns false if too late. */
    undo: (token: UndoToken): Promise<boolean> =>
      db.transaction(async (tx) => {
        const t = now();
        switch (token.kind) {
          case 'notes':
            return (await notes.undelete(tx, token.noteIds, token.at)) > 0 || token.noteIds.length === 0;
          case 'subject': {
            const s = await subjects.get(tx, token.subjectId);
            if (!s || s.name === WIPED_NAME) return false;
            await subjects.setDeleted(tx, token.subjectId, false);
            if (token.mode === 'move') {
              const { noteIds: n, folderIds: f } = token;
              if (n.length) await tx.run(`UPDATE notes SET subject = ?, updated = ? WHERE subject IS NULL AND id IN ${inList(n)}`, [token.subjectId, t, ...n]);
              if (f.length) await tx.run(`UPDATE folders SET subject = ?, updated = ? WHERE subject IS NULL AND id IN ${inList(f)}`, [token.subjectId, t, ...f]);
            } else {
              await notes.undelete(tx, token.noteIds, token.at);
              for (const f of token.folderIds) await folders.setDeleted(tx, f, false);
            }
            return true;
          }
          case 'folder': {
            const f = await folders.get(tx, token.folderId);
            if (!f || f.name === WIPED_NAME) return false;
            await folders.setDeleted(tx, token.folderId, false);
            const { noteIds: n, childFolderIds: c } = token;
            if (n.length) await tx.run(`UPDATE notes SET folder = ?, updated = ? WHERE folder IS NULL AND id IN ${inList(n)}`, [token.folderId, t, ...n]);
            if (c.length) await tx.run(`UPDATE folders SET parent = ?, updated = ? WHERE parent IS NULL AND id IN ${inList(c)}`, [token.folderId, t, ...c]);
            return true;
          }
        }
      }),

    /**
     * Sync bookkeeping for the P2b sync engine (docs/modules/sync.md). Each
     * call is its own transaction; run() groups several into one.
     */
    sync: {
      ...bindSync(syncRepo, (fn) => db.transaction(fn)),
      run: <T>(fn: (s: BoundSync) => Promise<T>): Promise<T> =>
        db.transaction((tx) => fn(bindSync(syncRepo, (f) => f(tx)))),
    },

    /** Wipes the text of everything deleted more than UNDO_WINDOW_MS ago. */
    purge,

    /**
     * "Delete all data": removes every row (secure_delete overwrites freed
     * pages), checkpoints the WAL and vacuums. The caller then closes the
     * store and deletes the database file.
     */
    wipeAll: async (): Promise<void> => {
      await db.transaction(async (tx) => {
        for (const t of ALL_TABLES) await tx.exec(`DELETE FROM ${t}`); // fixed table names
        await tx.exec(
          'UPDATE syncState SET uid = NULL, enabled = 0, applying = 0, initialSyncDone = 0, lastPushAt = NULL, lastPullAt = NULL, lastError = NULL',
        );
      });
      await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      await db.exec('VACUUM');
      log.info('wiped_all');
    },

    close: () => db.close(),
  };
  return store;
}

export type Store = Awaited<ReturnType<typeof openStore>>;
export type StoreSync = Store['sync'];
export type { BoundSync as SyncOps };
