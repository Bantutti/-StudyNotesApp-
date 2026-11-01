/**
 * Sync bookkeeping for P2b (docs/modules/sync.md). All SQL the sync engine
 * needs lives here, so the sync module never sees SQL (rule 2).
 *
 * The engine (src/modules/sync) works with raw rows (SqlRow, the local
 * column format: ms timestamps, 0/1 booleans, JSON-in-TEXT lists) and maps
 * them to cloud docs itself. This file only:
 *   - reads rows and the outbox,
 *   - writes pulled rows ("applying" mode: triggers don't re-queue them),
 *   - records upload results, conflicts, quarantine and pull cursors.
 *
 * Identifiers: table and column names come only from SYNC_TABLES and
 * TABLE_COLUMNS below (fixed code constants, checked by a test against
 * PRAGMA table_info). Values always use `?` placeholders.
 */
import { AppError, EMPTY_DOC_JSON, parseNoteDocJson } from '@/core';

import { SYNC_TABLES, type SyncTable } from './migrations';
import { num, str, strOrNull } from './rows';
import { indexNote, removeNoteFromIndex } from './search';
import type { SqlExecutor, SqlRow, SqlValue } from './sql';
import { versionHash } from './versions';

export { SYNC_TABLES, type SyncTable };

/** Every column of each synced table (cloud fields + local-only extras). */
export const TABLE_COLUMNS: Readonly<Record<SyncTable, readonly string[]>> = {
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
  assets: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'type', 'cloudPath', 'size', 'localPath'],
  stylePacks: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'version', 'definition',
    'createdFromReference'],
  templates: ['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'version', 'definition'],
};

/** Columns that never come from the cloud and are kept when a pulled row is applied. */
export const LOCAL_ONLY_COLUMNS: Readonly<Partial<Record<SyncTable, readonly string[]>>> = { assets: ['localPath'] };

export type OutboxState = 'pending' | 'conflict' | 'quarantined';
export type ConflictKind = 'edit_edit' | 'remote_deleted' | 'local_deleted';
export type QuarantineDirection = 'in' | 'out';

export interface OutboxItem {
  tbl: SyncTable;
  id: string;
  /** Local edits since the last successful upload (bumped by the triggers). */
  seq: number;
  state: OutboxState;
  /** What the last upload attempt sent (for "lost ack" detection). */
  sentSeq: number | null;
  sentRev: number | null;
  sentHash: string | null;
  attempts: number;
}

export interface SyncStateRow {
  /** The account this database is bound to (Q7). null = never bound. */
  uid: string | null;
  enabled: boolean;
  initialSyncDone: boolean;
  lastPushAt: number | null;
  lastPullAt: number | null;
  /** A short, content-free code (e.g. "network"), never a message. */
  lastError: string | null;
}

/** Exact server time (Firestore keeps microseconds; ms would lose them) plus the doc id for ties. */
export interface PullCursor {
  seconds: number;
  nanos: number;
  docId: string;
}

export interface ConflictRecord {
  tbl: SyncTable;
  id: string;
  kind: ConflictKind;
  serverRev: number;
  /** The server copy, already mapped to the local row format. */
  serverRow: SqlRow;
  detected: number;
}

export interface QuarantineRecord {
  tbl: SyncTable;
  id: string;
  direction: QuarantineDirection;
  reason: string;
  at: number;
}

const isTable = (t: unknown): t is SyncTable => typeof t === 'string' && (SYNC_TABLES as readonly string[]).includes(t);

function table(t: string): SyncTable {
  if (!isTable(t)) throw new AppError('internal', 'Unknown sync table.');
  return t;
}

/** Upload order as a SQL expression on fixed literals (users first). */
const ORDER_SQL = `CASE tbl ${SYNC_TABLES.map((t, i) => `WHEN '${t}' THEN ${i}`).join(' ')} END`;

const STATES: readonly OutboxState[] = ['pending', 'conflict', 'quarantined'];

function outboxOf(r: SqlRow): OutboxItem {
  const state = str(r.state) as OutboxState;
  return {
    tbl: table(str(r.tbl)),
    id: str(r.id),
    seq: num(r.seq),
    state: STATES.includes(state) ? state : 'pending',
    sentSeq: r.sentSeq === null ? null : num(r.sentSeq),
    sentRev: r.sentRev === null ? null : num(r.sentRev),
    sentHash: strOrNull(r.sentHash),
    attempts: num(r.attempts),
  };
}

/** Values allowed in a row written by applyRemote (what SQLite STRICT columns accept). */
function sqlValue(v: unknown, col: string): SqlValue {
  if (v === null || typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new AppError('validation_failed', `Bad value for ${col}.`);
}

export function createSyncRepo(deps: { now: () => number }) {
  /** Runs fn with the triggers paused: pulled data must not be queued for upload again. */
  const applying = async <T>(tx: SqlExecutor, fn: () => Promise<T>): Promise<T> => {
    await tx.run('UPDATE syncState SET applying = 1 WHERE id = 1');
    try {
      return await fn();
    } finally {
      await tx.run('UPDATE syncState SET applying = 0 WHERE id = 1');
    }
  };

  const getState = async (ex: SqlExecutor): Promise<SyncStateRow> => {
    const r = await ex.get('SELECT * FROM syncState WHERE id = 1');
    return {
      uid: strOrNull(r?.uid),
      enabled: r?.enabled === 1,
      initialSyncDone: r?.initialSyncDone === 1,
      lastPushAt: r?.lastPushAt == null ? null : num(r.lastPushAt),
      lastPullAt: r?.lastPullAt == null ? null : num(r.lastPullAt),
      lastError: strOrNull(r?.lastError),
    };
  };

  const readRow = async (ex: SqlExecutor, tbl: SyncTable, id: string): Promise<SqlRow | null> =>
    ex.get(`SELECT * FROM ${table(tbl)} WHERE id = ?`, [id]);

  /** Rebuilds a note's search rows (or removes them for a tombstone) after a pulled write. */
  const reindexNote = async (tx: SqlExecutor, row: SqlRow): Promise<void> => {
    const id = str(row.id);
    if (row.deleted === 1) {
      await removeNoteFromIndex(tx, id);
      // Deleted on another device: wipe local history too (plan §17 "Version history").
      await tx.run('DELETE FROM noteVersions WHERE note = ?', [id]);
      return;
    }
    const doc = parseNoteDocJson(str(row.document));
    if (!doc.ok) throw new AppError('validation_failed', 'A synced note could not be opened.');
    await indexNote(tx, id, str(row.title), doc.value);
  };

  return {
    applying,

    // ---- state -------------------------------------------------------------
    getState,

    /** Binds the database to an account. Refuses a different account (Q7). */
    async bind(tx: SqlExecutor, uid: string): Promise<void> {
      const s = await getState(tx);
      if (s.uid !== null && s.uid !== uid) {
        throw new AppError('permission_denied', 'This phone holds notes from another account. Remove them from this phone first.');
      }
      await tx.run('UPDATE syncState SET uid = ? WHERE id = 1', [uid]);
    },

    async setEnabled(tx: SqlExecutor, enabled: boolean): Promise<void> {
      await tx.run('UPDATE syncState SET enabled = ? WHERE id = 1', [enabled ? 1 : 0]);
    },

    async setInitialSyncDone(tx: SqlExecutor, done: boolean): Promise<void> {
      await tx.run('UPDATE syncState SET initialSyncDone = ? WHERE id = 1', [done ? 1 : 0]);
    },

    async recordRun(tx: SqlExecutor, what: 'push' | 'pull', error: string | null): Promise<void> {
      const col = what === 'push' ? 'lastPushAt' : 'lastPullAt';
      if (error === null) await tx.run(`UPDATE syncState SET ${col} = ?, lastError = NULL WHERE id = 1`, [deps.now()]);
      else await tx.run('UPDATE syncState SET lastError = ? WHERE id = 1', [error.slice(0, 40)]);
    },

    /**
     * After the account is deleted (or the user chose "Remove the link to
     * this account"): local data becomes guest data again. Rows keep their
     * content; owner and rev are cleared and every row is queued, so a later
     * sign-in uploads it as new.
     */
    async resetToGuest(tx: SqlExecutor): Promise<void> {
      await applying(tx, async () => {
        for (const t of SYNC_TABLES) {
          if (t === 'reviewLogs') await tx.run('UPDATE reviewLogs SET owner = NULL');
          else await tx.run(`UPDATE ${t} SET owner = NULL, rev = 0`);
        }
        await tx.run('UPDATE users SET deletionRequestedAt = NULL');
      });
      await tx.run('DELETE FROM syncOutbox');
      await tx.run('DELETE FROM syncCursors');
      await tx.run('DELETE FROM syncConflicts');
      await tx.run('DELETE FROM syncQuarantine');
      for (const t of SYNC_TABLES) await tx.run(`INSERT INTO syncOutbox (tbl, id, seq) SELECT '${t}', id, 1 FROM ${t}`);
      await tx.run(
        'UPDATE syncState SET uid = NULL, enabled = 0, initialSyncDone = 0, lastPushAt = NULL, lastPullAt = NULL, lastError = NULL WHERE id = 1',
      );
    },

    // ---- outbox --------------------------------------------------------------
    async listOutbox(ex: SqlExecutor, opts: { state?: OutboxState; limit?: number } = {}): Promise<OutboxItem[]> {
      const rows = await ex.all(
        `SELECT * FROM syncOutbox WHERE state = ? ORDER BY ${ORDER_SQL}, seq, id LIMIT ?`,
        [opts.state ?? 'pending', Math.min(Math.max(opts.limit ?? 200, 1), 1000)],
      );
      return rows.map(outboxOf);
    },

    async getOutbox(ex: SqlExecutor, tbl: SyncTable, id: string): Promise<OutboxItem | null> {
      const r = await ex.get('SELECT * FROM syncOutbox WHERE tbl = ? AND id = ?', [table(tbl), id]);
      return r ? outboxOf(r) : null;
    },

    /** Pending uploads per table (for the "Upload 42 notes?" confirm screen and the chip). */
    async countOutbox(ex: SqlExecutor, state: OutboxState = 'pending'): Promise<Partial<Record<SyncTable, number>>> {
      const rows = await ex.all('SELECT tbl, count(*) AS c FROM syncOutbox WHERE state = ? GROUP BY tbl', [state]);
      const out: Partial<Record<SyncTable, number>> = {};
      for (const r of rows) out[table(str(r.tbl))] = num(r.c);
      return out;
    },

    /** Records what an upload is about to send (before the network call). */
    async markSent(tx: SqlExecutor, tbl: SyncTable, id: string, sent: { seq: number; rev: number; hash: string }): Promise<void> {
      await tx.run('UPDATE syncOutbox SET sentSeq = ?, sentRev = ?, sentHash = ?, attempts = attempts + 1 WHERE tbl = ? AND id = ?', [
        sent.seq, sent.rev, sent.hash, table(tbl), id,
      ]);
    },

    /**
     * The server accepted (or already had) revision `rev` of this row. Sets
     * the local rev and owner; clears the outbox item only if nothing was
     * edited after `sentSeq` (otherwise it stays queued for the next upload).
     */
    async markPushed(tx: SqlExecutor, tbl: SyncTable, id: string, r: { sentSeq: number; rev: number; owner: string }): Promise<void> {
      const t = table(tbl);
      await applying(tx, async () => {
        if (t === 'reviewLogs') await tx.run('UPDATE reviewLogs SET owner = ? WHERE id = ?', [r.owner, id]);
        else await tx.run(`UPDATE ${t} SET rev = ?, owner = ? WHERE id = ?`, [r.rev, r.owner, id]);
      });
      const del = await tx.run('DELETE FROM syncOutbox WHERE tbl = ? AND id = ? AND seq = ?', [t, id, r.sentSeq]);
      if (del.changes === 0) {
        await tx.run(
          "UPDATE syncOutbox SET sentSeq = NULL, sentRev = NULL, sentHash = NULL, attempts = 0, state = 'pending' WHERE tbl = ? AND id = ?",
          [t, id],
        );
      }
      await tx.run("DELETE FROM syncQuarantine WHERE tbl = ? AND id = ? AND direction = 'out'", [t, id]);
    },

    async setOutboxState(tx: SqlExecutor, tbl: SyncTable, id: string, state: OutboxState): Promise<void> {
      await tx.run('UPDATE syncOutbox SET state = ? WHERE tbl = ? AND id = ?', [state, table(tbl), id]);
    },

    async removeOutbox(tx: SqlExecutor, tbl: SyncTable, id: string): Promise<void> {
      await tx.run('DELETE FROM syncOutbox WHERE tbl = ? AND id = ?', [table(tbl), id]);
    },

    /** Queues a row for upload without a local edit (e.g. "Keep mine"). */
    async requeue(tx: SqlExecutor, tbl: SyncTable, id: string): Promise<void> {
      await tx.run(
        `INSERT INTO syncOutbox (tbl, id, seq) VALUES (?, ?, 1)
         ON CONFLICT (tbl, id) DO UPDATE SET seq = seq + 1, state = 'pending', sentSeq = NULL, sentRev = NULL, sentHash = NULL`,
        [table(tbl), id],
      );
    },

    // ---- rows ----------------------------------------------------------------
    readRow,

    /** Sets only the local rev (used by "Keep mine": the next upload sends rev + 1 on top of the server copy). */
    async setLocalRev(tx: SqlExecutor, tbl: SyncTable, id: string, rev: number): Promise<void> {
      const t = table(tbl);
      if (t === 'reviewLogs') return;
      await applying(tx, () => tx.run(`UPDATE ${t} SET rev = ? WHERE id = ?`, [rev, id]));
    },

    /**
     * Writes a pulled row (already validated and mapped by the sync module).
     * Keys must be columns of the table; local-only columns keep their local
     * value. Notes get their search rows rebuilt; a pulled tombstone also
     * wipes the note's local version history.
     */
    async applyRemote(tx: SqlExecutor, tbl: SyncTable, row: SqlRow): Promise<void> {
      const t = table(tbl);
      const allowed = TABLE_COLUMNS[t];
      const localOnly = LOCAL_ONLY_COLUMNS[t] ?? [];
      const cols = Object.keys(row);
      for (const c of cols) {
        if (!allowed.includes(c) || localOnly.includes(c)) throw new AppError('validation_failed', `Unexpected field ${c}.`);
      }
      if (!cols.includes('id')) throw new AppError('validation_failed', 'Missing id.');
      const values = cols.map((c) => sqlValue(row[c], c));
      const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
      await applying(tx, async () => {
        await tx.run(
          `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
           ON CONFLICT (id) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`,
          values,
        );
        if (t === 'notes') {
          const stored = await readRow(tx, 'notes', str(row.id));
          if (stored) await reindexNote(tx, stored);
        }
      });
      await tx.run("DELETE FROM syncQuarantine WHERE tbl = ? AND id = ? AND direction = 'in'", [t, str(row.id)]);
    },

    /**
     * Saves fixed block ids into a note before upload, so cards and anchors
     * on every device point at the same ids (P2a blockId fix). Compare and
     * set: if the note changed since `expectedJson` was read, nothing is
     * written (that edit is queued and will be prepared on the next round).
     * Not queued again: the caller uploads this exact document next.
     */
    async replaceNoteDocument(tx: SqlExecutor, id: string, expectedJson: string, json: string): Promise<boolean> {
      return applying(tx, async () => {
        const r = await tx.run('UPDATE notes SET document = ? WHERE id = ? AND document = ?', [json, id, expectedJson]);
        if (r.changes === 0) return false;
        const stored = await readRow(tx, 'notes', id);
        if (stored && stored.deleted !== 1) await reindexNote(tx, stored);
        return true;
      });
    },

    /**
     * Saves a note version from a row (local or server copy) before a sync
     * merge ("Before sync merge", plan F14). Deleted or wiped rows are skipped.
     */
    async snapshotRow(tx: SqlExecutor, noteRow: SqlRow, newId: string): Promise<boolean> {
      const noteId = str(noteRow.id);
      const document = str(noteRow.document);
      if (noteRow.deleted === 1 || document === EMPTY_DOC_JSON || !document) return false;
      if (!(await tx.get('SELECT id FROM notes WHERE id = ?', [noteId]))) return false;
      const title = str(noteRow.title);
      const pack = str(noteRow.stylePackId);
      await tx.run(
        "INSERT INTO noteVersions (id, note, created, reason, title, stylePackId, document, hash) VALUES (?, ?, ?, 'before_sync_merge', ?, ?, ?, ?)",
        [newId, noteId, deps.now(), title, pack, document, versionHash(title, pack, document)],
      );
      return true;
    },

    /**
     * "Keep both": saves `row` (my version) as a NEW note with `newId`, never
     * uploaded yet (rev 0, owner null). The insert trigger queues it.
     */
    async insertNoteCopy(tx: SqlExecutor, row: SqlRow, newId: string, title: string): Promise<void> {
      const t = deps.now();
      await tx.run(
        `INSERT INTO notes (id, owner, schemaVersion, created, updated, rev, deleted, subject, folder, title,
           document, inkLayerRef, stylePackId, templateId, tags)
         VALUES (?, NULL, 1, ?, ?, 0, 0, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [newId, t, t, strOrNull(row.subject), strOrNull(row.folder), title, str(row.document),
          str(row.stylePackId), strOrNull(row.templateId), str(row.tags) || '[]'],
      );
      const stored = await readRow(tx, 'notes', newId);
      if (stored) await reindexNote(tx, stored);
    },

    // ---- conflicts -------------------------------------------------------------
    async putConflict(tx: SqlExecutor, c: Omit<ConflictRecord, 'detected'>): Promise<void> {
      const t = table(c.tbl);
      await tx.run(
        `INSERT INTO syncConflicts (tbl, id, kind, serverRev, serverRow, detected) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (tbl, id) DO UPDATE SET kind = excluded.kind, serverRev = excluded.serverRev,
           serverRow = excluded.serverRow, detected = excluded.detected`,
        [t, c.id, c.kind, c.serverRev, JSON.stringify(c.serverRow), deps.now()],
      );
      await tx.run(
        `INSERT INTO syncOutbox (tbl, id, seq, state) VALUES (?, ?, 1, 'conflict')
         ON CONFLICT (tbl, id) DO UPDATE SET state = 'conflict'`,
        [t, c.id],
      );
    },

    async listConflicts(ex: SqlExecutor): Promise<ConflictRecord[]> {
      const rows = await ex.all(`SELECT * FROM syncConflicts ORDER BY ${ORDER_SQL}, detected`);
      return rows.flatMap((r) => {
        try {
          const serverRow = JSON.parse(str(r.serverRow)) as unknown;
          if (typeof serverRow !== 'object' || serverRow === null || Array.isArray(serverRow)) return [];
          return [{
            tbl: table(str(r.tbl)),
            id: str(r.id),
            kind: str(r.kind) as ConflictKind,
            serverRev: num(r.serverRev),
            serverRow: serverRow as SqlRow,
            detected: num(r.detected),
          }];
        } catch {
          return [];
        }
      });
    },

    async removeConflict(tx: SqlExecutor, tbl: SyncTable, id: string): Promise<void> {
      await tx.run('DELETE FROM syncConflicts WHERE tbl = ? AND id = ?', [table(tbl), id]);
    },

    async countConflicts(ex: SqlExecutor): Promise<number> {
      return num((await ex.get('SELECT count(*) AS c FROM syncConflicts'))?.c);
    },

    // ---- quarantine (ids and reason codes only) --------------------------------
    async quarantine(tx: SqlExecutor, q: Omit<QuarantineRecord, 'at'>): Promise<void> {
      const t = table(q.tbl);
      await tx.run(
        `INSERT INTO syncQuarantine (tbl, id, direction, reason, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tbl, id, direction) DO UPDATE SET reason = excluded.reason, at = excluded.at`,
        [t, q.id.slice(0, 128), q.direction, q.reason.slice(0, 60), deps.now()],
      );
      if (q.direction === 'out') await tx.run("UPDATE syncOutbox SET state = 'quarantined' WHERE tbl = ? AND id = ?", [t, q.id]);
    },

    async listQuarantine(ex: SqlExecutor): Promise<QuarantineRecord[]> {
      const rows = await ex.all('SELECT * FROM syncQuarantine ORDER BY at DESC LIMIT 500');
      return rows.map((r) => ({
        tbl: table(str(r.tbl)),
        id: str(r.id),
        direction: str(r.direction) === 'out' ? 'out' : 'in',
        reason: str(r.reason),
        at: num(r.at),
      }));
    },

    // ---- pull cursors -------------------------------------------------------------
    async getCursor(ex: SqlExecutor, tbl: SyncTable): Promise<PullCursor | null> {
      const r = await ex.get('SELECT seconds, nanos, docId FROM syncCursors WHERE tbl = ?', [table(tbl)]);
      return r ? { seconds: num(r.seconds), nanos: num(r.nanos), docId: str(r.docId) } : null;
    },

    async setCursor(tx: SqlExecutor, tbl: SyncTable, c: PullCursor): Promise<void> {
      await tx.run(
        `INSERT INTO syncCursors (tbl, seconds, nanos, docId) VALUES (?, ?, ?, ?)
         ON CONFLICT (tbl) DO UPDATE SET seconds = excluded.seconds, nanos = excluded.nanos, docId = excluded.docId`,
        [table(tbl), Math.trunc(c.seconds), Math.trunc(c.nanos), c.docId],
      );
    },
  };
}

export type SyncRepo = ReturnType<typeof createSyncRepo>;
