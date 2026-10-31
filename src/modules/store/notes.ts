/**
 * Notes repository. A save writes the note row and its search rows in ONE
 * transaction, so search never disagrees with the note.
 */
import * as z from 'zod';

import {
  AppError,
  EMPTY_DOC_JSON,
  emptyNoteDoc,
  parseNoteDocJson,
  prepareDocForSave,
  refIdSchema,
  TEXT_LIMITS,
  LIST_LIMITS,
  type IdGenerator,
  type NoteDoc,
} from '@/core';

import { cleanLine, inList, jsonList, metaFromRow, str, strOrNull } from './rows';
import { indexNote, removeNoteFromIndex } from './search';
import type { SqlExecutor, SqlRow } from './sql';
import type { Note, NoteListItem, NoteMeta, NoteScope, NoteSort } from './types';

export interface NotesDeps {
  ids: IdGenerator;
  now: () => number;
}

const tagItem = z.string().min(1).max(TEXT_LIMITS.tag);

/** Cleans and validates tags: trimmed, unique (case-insensitive), 1..40 UTF-16 units, at most 20. */
export function cleanTags(input: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const t = cleanLine(raw).replace(/^#+/, '');
    if (!t) continue;
    if (t.length > TEXT_LIMITS.tag) throw new AppError('validation_failed', `Tags can be at most ${TEXT_LIMITS.tag} characters.`);
    const k = t.toLocaleLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  if (out.length > LIST_LIMITS.tags) throw new AppError('validation_failed', `A note can have at most ${LIST_LIMITS.tags} tags.`);
  return out;
}

export function cleanTitle(input: string): string {
  const t = cleanLine(input);
  if (t.length > TEXT_LIMITS.noteTitle) {
    throw new AppError('validation_failed', `Titles can be at most ${TEXT_LIMITS.noteTitle} characters.`);
  }
  return t;
}

function packId(v: string): string {
  if (!refIdSchema.safeParse(v).success) throw new AppError('validation_failed', 'Unknown style pack.');
  return v;
}

const META_COLS = `n.id, n.owner, n.created, n.updated, n.rev, n.deleted, n.subject, n.folder, n.title,
  n.inkLayerRef, n.stylePackId, n.templateId, n.tags`;

function metaOf(r: SqlRow): NoteMeta {
  return {
    ...metaFromRow(r),
    subject: strOrNull(r.subject),
    folder: strOrNull(r.folder),
    title: str(r.title),
    inkLayerRef: strOrNull(r.inkLayerRef),
    stylePackId: str(r.stylePackId),
    templateId: strOrNull(r.templateId),
    tags: jsonList(r.tags, tagItem),
  };
}

async function assertLinks(tx: SqlExecutor, subject: string | null, folder: string | null): Promise<void> {
  if (subject !== null) {
    const s = await tx.get('SELECT id FROM subjects WHERE id = ? AND deleted = 0', [subject]);
    if (!s) throw new AppError('not_found', 'That subject no longer exists.');
  }
  if (folder !== null) {
    const f = await tx.get<{ subject: string | null }>('SELECT subject FROM folders WHERE id = ? AND deleted = 0', [folder]);
    if (!f) throw new AppError('not_found', 'That folder no longer exists.');
    if ((f.subject ?? null) !== subject) throw new AppError('validation_failed', 'That folder belongs to another subject.');
  }
}

export interface CreateNoteInput {
  subject?: string | null;
  folder?: string | null;
  title?: string;
  document?: NoteDoc;
  stylePackId: string;
  templateId?: string | null;
  tags?: string[];
}

export interface NotePatch {
  title?: string;
  document?: unknown;
  stylePackId?: string;
  templateId?: string | null;
  tags?: string[];
  subject?: string | null;
  folder?: string | null;
}

export interface SaveResult {
  note: NoteMeta;
  /** Share of the cloud size cap used by the document (warn above 0.8). */
  usage: number;
}

export function createNotesRepo(deps: NotesDeps) {
  const read = async (ex: SqlExecutor, id: string): Promise<{ meta: NoteMeta; json: string } | null> => {
    const r = await ex.get(`SELECT ${META_COLS}, n.document FROM notes n WHERE n.id = ?`, [id]);
    return r ? { meta: metaOf(r), json: str(r.document) } : null;
  };

  const getNote = async (ex: SqlExecutor, id: string): Promise<Note | null> => {
    const row = await read(ex, id);
    if (!row) return null;
    const doc = parseNoteDocJson(row.json);
    if (!doc.ok) throw new AppError('validation_failed', 'This note could not be opened because its data is damaged.');
    return { ...row.meta, document: doc.value };
  };

  return {
    async create(tx: SqlExecutor, input: CreateNoteInput): Promise<Note> {
      const subject = input.subject ?? null;
      const folder = input.folder ?? null;
      await assertLinks(tx, subject, folder);
      const prepared = prepareDocForSave(input.document ?? emptyNoteDoc(deps.ids), deps.ids);
      if (!prepared.ok) throw prepared.error;
      const title = cleanTitle(input.title ?? '');
      const tags = cleanTags(input.tags ?? []);
      const stylePackId = packId(input.stylePackId);
      const templateId = input.templateId ? packId(input.templateId) : null;
      const id = deps.ids.newId('n');
      const t = deps.now();
      await tx.run(
        `INSERT INTO notes (id, owner, schemaVersion, created, updated, rev, deleted, subject, folder, title,
           document, inkLayerRef, stylePackId, templateId, tags)
         VALUES (?, NULL, 1, ?, ?, 0, 0, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [id, t, t, subject, folder, title, prepared.value.json, stylePackId, templateId, JSON.stringify(tags)],
      );
      await indexNote(tx, id, title, prepared.value.doc);
      return {
        id, owner: null, created: t, updated: t, rev: 0, deleted: false, subject, folder, title,
        inkLayerRef: null, stylePackId, templateId, tags, document: prepared.value.doc,
      };
    },

    /** Loads a note and validates its document. Deleted notes are returned with deleted = true. */
    get: getNote,

    async save(tx: SqlExecutor, id: string, patch: NotePatch): Promise<SaveResult> {
      const row = await read(tx, id);
      if (!row || row.meta.deleted) throw new AppError('not_found', 'This note no longer exists.');
      const next = { ...row.meta };
      let json = row.json;
      let usage = 0;
      let doc: NoteDoc | null = null;
      if (patch.document !== undefined) {
        const prepared = prepareDocForSave(patch.document, deps.ids);
        if (!prepared.ok) throw prepared.error;
        json = prepared.value.json;
        usage = prepared.value.usage;
        doc = prepared.value.doc;
      }
      if (patch.title !== undefined) next.title = cleanTitle(patch.title);
      if (patch.tags !== undefined) next.tags = cleanTags(patch.tags);
      if (patch.stylePackId !== undefined) next.stylePackId = packId(patch.stylePackId);
      if (patch.templateId !== undefined) next.templateId = patch.templateId === null ? null : packId(patch.templateId);
      if (patch.subject !== undefined || patch.folder !== undefined) {
        next.subject = patch.subject !== undefined ? patch.subject : next.subject;
        // Moving to another subject drops the folder unless a new one is given.
        next.folder = patch.folder !== undefined ? patch.folder : next.subject === row.meta.subject ? next.folder : null;
        await assertLinks(tx, next.subject, next.folder);
      }
      next.updated = Math.max(deps.now(), row.meta.updated);
      await tx.run(
        `UPDATE notes SET updated = ?, subject = ?, folder = ?, title = ?, document = ?, stylePackId = ?,
           templateId = ?, tags = ? WHERE id = ?`,
        [next.updated, next.subject, next.folder, next.title, json, next.stylePackId, next.templateId,
          JSON.stringify(next.tags), id],
      );
      if (doc !== null || next.title !== row.meta.title) {
        const parsed = doc ?? (await getNote(tx, id))?.document;
        if (parsed) await indexNote(tx, id, next.title, parsed);
      }
      return { note: next, usage };
    },

    async list(ex: SqlExecutor, scope: NoteScope, opts: { sort?: NoteSort; tag?: string; limit?: number } = {}): Promise<NoteListItem[]> {
      const where: string[] = ['n.deleted = 0'];
      const params: (string | number | null)[] = [];
      if (scope.scope === 'inbox') where.push('n.subject IS NULL');
      if (scope.scope === 'subject') {
        where.push('n.subject = ?');
        params.push(scope.subjectId);
      }
      if (scope.scope !== 'all') {
        if (scope.folderId === null) where.push('n.folder IS NULL');
        else if (typeof scope.folderId === 'string') {
          where.push('n.folder = ?');
          params.push(scope.folderId);
        }
      }
      if (opts.tag) {
        where.push('EXISTS (SELECT 1 FROM json_each(n.tags) WHERE value = ?)');
        params.push(opts.tag);
      }
      // Whitelisted ORDER BY clauses only; never built from input.
      const order = { updated: 'n.updated DESC', created: 'n.created DESC', title: 'n.title COLLATE NOCASE ASC, n.updated DESC' }[
        opts.sort ?? 'updated'
      ];
      params.push(Math.min(Math.max(opts.limit ?? 500, 1), 1000));
      const rows = await ex.all(
        `SELECT ${META_COLS},
           (SELECT s.text FROM searchMap m JOIN search s ON s.rowid = m.rowid
             WHERE m.noteId = n.id AND m.kind != 'title' ORDER BY m.rowid LIMIT 1) AS preview
         FROM notes n WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`,
        params,
      );
      return rows.map((r) => ({ ...metaOf(r), preview: str(r.preview) }));
    },

    /** Live note count per subject (null key = Inbox). */
    async countBySubject(ex: SqlExecutor): Promise<Map<string | null, number>> {
      const rows = await ex.all('SELECT subject, count(*) AS c FROM notes WHERE deleted = 0 GROUP BY subject');
      return new Map(rows.map((r) => [strOrNull(r.subject), Number(r.c)]));
    },

    /** All tags in use, most used first. */
    async tags(ex: SqlExecutor, subjectId?: string): Promise<{ tag: string; count: number }[]> {
      const rows = await ex.all(
        `SELECT j.value AS tag, count(*) AS c FROM notes n, json_each(n.tags) j
          WHERE n.deleted = 0 ${subjectId ? 'AND n.subject = ?' : ''}
          GROUP BY j.value ORDER BY c DESC, j.value COLLATE NOCASE LIMIT 200`,
        subjectId ? [subjectId] : [],
      );
      return rows.map((r) => ({ tag: str(r.tag), count: Number(r.c) }));
    },

    /** Soft delete (tombstone). Text stays until purge so Undo can bring it back. */
    async softDelete(tx: SqlExecutor, ids: readonly string[]): Promise<string[]> {
      if (ids.length === 0) return [];
      const live = await tx.all(`SELECT id FROM notes WHERE deleted = 0 AND id IN ${inList(ids)}`, [...ids]);
      const hit = live.map((r) => str(r.id));
      if (hit.length) {
        await tx.run(`UPDATE notes SET deleted = 1, updated = ? WHERE id IN ${inList(hit)}`, [deps.now(), ...hit]);
      }
      return hit;
    },

    /** Brings back notes deleted within the undo window (not yet wiped). */
    async undelete(tx: SqlExecutor, ids: readonly string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const r = await tx.run(
        `UPDATE notes SET deleted = 0, updated = ? WHERE deleted = 1 AND document != ? AND id IN ${inList(ids)}`,
        [deps.now(), EMPTY_DOC_JSON, ...ids],
      );
      return r.changes;
    },

    /**
     * Wipes the text of notes deleted before `cutoff`: document, title and tags
     * are cleared, versions and search rows removed. The tombstone row stays
     * so the deletion can sync (P2b). With secure_delete on, freed pages are
     * overwritten.
     */
    async purgeDeleted(tx: SqlExecutor, cutoff: number): Promise<number> {
      const rows = await tx.all('SELECT id FROM notes WHERE deleted = 1 AND document != ? AND updated <= ?', [EMPTY_DOC_JSON, cutoff]);
      for (const r of rows) {
        const id = str(r.id);
        await tx.run("UPDATE notes SET document = ?, title = '', tags = '[]', inkLayerRef = NULL WHERE id = ?", [EMPTY_DOC_JSON, id]);
        await tx.run('DELETE FROM noteVersions WHERE note = ?', [id]);
        await removeNoteFromIndex(tx, id);
      }
      return rows.length;
    },

  };
}

export type NotesRepo = ReturnType<typeof createNotesRepo>;
