/**
 * Version history (plan F14, decision Q9): local only, last 20 per note,
 * duplicates skipped, wiped with the note.
 */
import { AppError, parseNoteDocJson, type IdGenerator } from '@/core';

import { num, str } from './rows';
import type { SqlExecutor, SqlRow } from './sql';
import { VERSION_REASONS, type Version, type VersionMeta, type VersionReason } from './types';

export const VERSIONS_KEPT = 20;

/** cyrb53: fast 53-bit string hash for duplicate detection (not security). */
export function hash53(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const versionHash = (title: string, stylePackId: string, documentJson: string) =>
  hash53(`${title}\u0000${stylePackId}\u0000${documentJson}`);

function metaOf(r: SqlRow): VersionMeta {
  const reason = str(r.reason) as VersionReason;
  return {
    id: str(r.id),
    note: str(r.note),
    created: num(r.created),
    reason: (VERSION_REASONS as readonly string[]).includes(reason) ? reason : 'edit',
    title: str(r.title),
    stylePackId: str(r.stylePackId),
  };
}

export function createVersionsRepo(deps: { ids: IdGenerator; now: () => number }) {
  return {
    /**
     * Saves the note's CURRENT stored state as a version. Returns null when it
     * equals the newest version (duplicate) or the note doesn't exist, except
     * that a "before_*" checkpoint relabels a duplicate plain edit/leave version.
     */
    async snapshot(tx: SqlExecutor, noteId: string, reason: VersionReason): Promise<VersionMeta | null> {
      const note = await tx.get('SELECT title, stylePackId, document, deleted FROM notes WHERE id = ?', [noteId]);
      if (!note || note.deleted === 1) return null;
      const title = str(note.title);
      const pack = str(note.stylePackId);
      const doc = str(note.document);
      const hash = versionHash(title, pack, doc);
      const last = await tx.get('SELECT id, hash, reason FROM noteVersions WHERE note = ? ORDER BY created DESC, rowid DESC LIMIT 1', [noteId]);
      const created = deps.now();
      if (last && str(last.hash) === hash) {
        // Same content as the newest version. A labelled checkpoint ("Before
        // Beautify") replaces a plain edit/leave label so History shows why.
        const plain = last.reason === 'edit' || last.reason === 'leave';
        if (!reason.startsWith('before_') || !plain) return null;
        await tx.run('UPDATE noteVersions SET reason = ?, created = ? WHERE id = ?', [reason, created, str(last.id)]);
        return { id: str(last.id), note: noteId, created, reason, title, stylePackId: pack };
      }
      const id = deps.ids.newId('v');
      await tx.run(
        'INSERT INTO noteVersions (id, note, created, reason, title, stylePackId, document, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, noteId, created, reason, title, pack, doc, hash],
      );
      await tx.run(
        `DELETE FROM noteVersions WHERE note = ? AND id NOT IN
           (SELECT id FROM noteVersions WHERE note = ? ORDER BY created DESC, rowid DESC LIMIT ?)`,
        [noteId, noteId, VERSIONS_KEPT],
      );
      return { id, note: noteId, created, reason, title, stylePackId: pack };
    },

    async list(ex: SqlExecutor, noteId: string): Promise<VersionMeta[]> {
      const rows = await ex.all(
        'SELECT id, note, created, reason, title, stylePackId FROM noteVersions WHERE note = ? ORDER BY created DESC, rowid DESC',
        [noteId],
      );
      return rows.map(metaOf);
    },

    async get(ex: SqlExecutor, id: string): Promise<Version | null> {
      const r = await ex.get('SELECT * FROM noteVersions WHERE id = ?', [id]);
      if (!r) return null;
      const doc = parseNoteDocJson(str(r.document));
      if (!doc.ok) throw new AppError('validation_failed', 'This version could not be opened because its data is damaged.');
      return { ...metaOf(r), document: doc.value };
    },

    /** Time of the newest version (0 if none), for the "every 10 minutes" rule. */
    async latestAt(ex: SqlExecutor, noteId: string): Promise<number> {
      const r = await ex.get('SELECT max(created) AS t FROM noteVersions WHERE note = ?', [noteId]);
      return num(r?.t);
    },
  };
}

export type VersionsRepo = ReturnType<typeof createVersionsRepo>;
