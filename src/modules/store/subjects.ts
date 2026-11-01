/** Subjects and folders repositories. */
import * as z from 'zod';

import {
  AppError,
  HEX6_PATTERN,
  ICON_PATTERN,
  LIST_LIMITS,
  refIdSchema,
  syncedText,
  TEXT_LIMITS,
  type IdGenerator,
} from '@/core';

import { bool, cleanLine, int01, jsonList, metaFromRow, str, strOrNull } from './rows';
import type { SqlExecutor, SqlRow } from './sql';
import type { Folder, Subject } from './types';

export interface RepoDeps {
  ids: IdGenerator;
  now: () => number;
}

/** Name shown on a subject or folder whose text was wiped after deletion (cloud needs 1+ chars). */
export const WIPED_NAME = 'Deleted';

const examDate = z.number().int().min(0).max(8_640_000_000_000_000);

function cleanName(input: string, max: number, what: string): string {
  const n = cleanLine(input);
  if (!n) throw new AppError('validation_failed', `Give the ${what} a name.`);
  const rule = what === 'subject' ? syncedText.subjectName : syncedText.folderName; // UTF-16 counting (P2a §6.2)
  if (!rule.safeParse(n).success) throw new AppError('validation_failed', `${what[0]?.toUpperCase()}${what.slice(1)} names can be at most ${max} characters.`);
  return n;
}

/** Accepts "#4F7CF7" or "4f7cf7"; stores "4F7CF7" (cloud format, no '#'). */
export function toHex6(color: string): string {
  const c = color.trim().replace(/^#/, '').toUpperCase();
  if (!HEX6_PATTERN.test(c)) throw new AppError('validation_failed', 'Pick a colour from the list.');
  return c;
}

const subjectPatchSchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().regex(ICON_PATTERN).optional(),
  defaultPack: refIdSchema.nullable().optional(),
  defaultTemplate: refIdSchema.nullable().optional(),
  examDates: z.array(examDate).max(LIST_LIMITS.examDates).optional(),
  aiAllowed: z.boolean().optional(),
  autoMakeCards: z.boolean().optional(),
});
export type SubjectPatch = z.infer<typeof subjectPatchSchema>;
export type CreateSubjectInput = SubjectPatch & { name: string; color: string };

function subjectOf(r: SqlRow): Subject {
  return {
    ...metaFromRow(r),
    name: str(r.name),
    color: str(r.color),
    icon: str(r.icon),
    defaultPack: strOrNull(r.defaultPack),
    defaultTemplate: strOrNull(r.defaultTemplate),
    examDates: jsonList(r.examDates, examDate).sort((a, b) => a - b),
    aiAllowed: bool(r.aiAllowed),
    autoMakeCards: bool(r.autoMakeCards),
  };
}

function folderOf(r: SqlRow): Folder {
  return { ...metaFromRow(r), subject: strOrNull(r.subject), name: str(r.name), parent: strOrNull(r.parent) };
}

export function createSubjectsRepo(deps: RepoDeps) {
  const parsePatch = (p: unknown): SubjectPatch => {
    const r = subjectPatchSchema.safeParse(p);
    if (!r.success) throw new AppError('validation_failed', 'Those subject details are not valid.');
    return r.data;
  };

  const get = async (ex: SqlExecutor, id: string): Promise<Subject | null> => {
    const r = await ex.get('SELECT * FROM subjects WHERE id = ?', [id]);
    return r ? subjectOf(r) : null;
  };

  return {
    get,

    async list(ex: SqlExecutor): Promise<Subject[]> {
      const rows = await ex.all('SELECT * FROM subjects WHERE deleted = 0 ORDER BY name COLLATE NOCASE');
      return rows.map(subjectOf);
    },

    async create(tx: SqlExecutor, input: CreateSubjectInput): Promise<Subject> {
      const p = parsePatch(input);
      const name = cleanName(input.name, TEXT_LIMITS.subjectName, 'subject');
      const color = toHex6(input.color);
      const id = deps.ids.newId('s');
      const t = deps.now();
      const examDates = [...new Set(p.examDates ?? [])].sort((a, b) => a - b);
      await tx.run(
        `INSERT INTO subjects (id, owner, schemaVersion, created, updated, rev, deleted, name, color, icon,
           defaultPack, defaultTemplate, examDates, aiAllowed, autoMakeCards)
         VALUES (?, NULL, 1, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, t, t, name, color, p.icon ?? 'book', p.defaultPack ?? null, p.defaultTemplate ?? null,
          JSON.stringify(examDates), int01(p.aiAllowed ?? true), int01(p.autoMakeCards ?? false)],
      );
      return (await get(tx, id)) as Subject;
    },

    async update(tx: SqlExecutor, id: string, patch: SubjectPatch): Promise<Subject> {
      const cur = await get(tx, id);
      if (!cur || cur.deleted) throw new AppError('not_found', 'That subject no longer exists.');
      const p = parsePatch(patch);
      const next: Subject = {
        ...cur,
        name: p.name !== undefined ? cleanName(p.name, TEXT_LIMITS.subjectName, 'subject') : cur.name,
        color: p.color !== undefined ? toHex6(p.color) : cur.color,
        icon: p.icon ?? cur.icon,
        defaultPack: p.defaultPack !== undefined ? p.defaultPack : cur.defaultPack,
        defaultTemplate: p.defaultTemplate !== undefined ? p.defaultTemplate : cur.defaultTemplate,
        examDates: p.examDates !== undefined ? [...new Set(p.examDates)].sort((a, b) => a - b) : cur.examDates,
        aiAllowed: p.aiAllowed ?? cur.aiAllowed,
        autoMakeCards: p.autoMakeCards ?? cur.autoMakeCards,
        updated: Math.max(deps.now(), cur.updated),
      };
      await tx.run(
        `UPDATE subjects SET updated = ?, name = ?, color = ?, icon = ?, defaultPack = ?, defaultTemplate = ?,
           examDates = ?, aiAllowed = ?, autoMakeCards = ? WHERE id = ?`,
        [next.updated, next.name, next.color, next.icon, next.defaultPack, next.defaultTemplate,
          JSON.stringify(next.examDates), int01(next.aiAllowed), int01(next.autoMakeCards), id],
      );
      return next;
    },

    async setDeleted(tx: SqlExecutor, id: string, deleted: boolean): Promise<void> {
      await tx.run('UPDATE subjects SET deleted = ?, updated = ? WHERE id = ?', [int01(deleted), deps.now(), id]);
    },

    async purgeDeleted(tx: SqlExecutor, cutoff: number): Promise<number> {
      const r = await tx.run('UPDATE subjects SET name = ? WHERE deleted = 1 AND name != ? AND updated <= ?', [WIPED_NAME, WIPED_NAME, cutoff]);
      return r.changes;
    },
  };
}

export function createFoldersRepo(deps: RepoDeps) {
  const get = async (ex: SqlExecutor, id: string): Promise<Folder | null> => {
    const r = await ex.get('SELECT * FROM folders WHERE id = ?', [id]);
    return r ? folderOf(r) : null;
  };

  return {
    get,

    /** Live folders of a subject (null = Inbox folders), by name. */
    async list(ex: SqlExecutor, subjectId: string | null): Promise<Folder[]> {
      const rows = await ex.all(
        `SELECT * FROM folders WHERE deleted = 0 AND ${subjectId === null ? 'subject IS NULL' : 'subject = ?'}
         ORDER BY name COLLATE NOCASE`,
        subjectId === null ? [] : [subjectId],
      );
      return rows.map(folderOf);
    },

    async create(tx: SqlExecutor, input: { subject: string | null; name: string; parent?: string | null }): Promise<Folder> {
      const name = cleanName(input.name, TEXT_LIMITS.folderName, 'folder');
      if (input.subject !== null) {
        const s = await tx.get('SELECT id FROM subjects WHERE id = ? AND deleted = 0', [input.subject]);
        if (!s) throw new AppError('not_found', 'That subject no longer exists.');
      }
      const parent = input.parent ?? null;
      if (parent !== null) {
        const p = await get(tx, parent);
        if (!p || p.deleted || p.subject !== input.subject) throw new AppError('validation_failed', 'That parent folder is not valid.');
      }
      const id = deps.ids.newId('f');
      const t = deps.now();
      await tx.run(
        `INSERT INTO folders (id, owner, schemaVersion, created, updated, rev, deleted, subject, name, parent)
         VALUES (?, NULL, 1, ?, ?, 0, 0, ?, ?, ?)`,
        [id, t, t, input.subject, name, parent],
      );
      return (await get(tx, id)) as Folder;
    },

    async rename(tx: SqlExecutor, id: string, name: string): Promise<Folder> {
      const cur = await get(tx, id);
      if (!cur || cur.deleted) throw new AppError('not_found', 'That folder no longer exists.');
      const clean = cleanName(name, TEXT_LIMITS.folderName, 'folder');
      await tx.run('UPDATE folders SET name = ?, updated = ? WHERE id = ?', [clean, Math.max(deps.now(), cur.updated), id]);
      return (await get(tx, id)) as Folder;
    },

    async setDeleted(tx: SqlExecutor, id: string, deleted: boolean): Promise<void> {
      await tx.run('UPDATE folders SET deleted = ?, updated = ? WHERE id = ?', [int01(deleted), deps.now(), id]);
    },

    async purgeDeleted(tx: SqlExecutor, cutoff: number): Promise<number> {
      const r = await tx.run('UPDATE folders SET name = ? WHERE deleted = 1 AND name != ? AND updated <= ?', [WIPED_NAME, WIPED_NAME, cutoff]);
      return r.changes;
    },
  };
}

export type SubjectsRepo = ReturnType<typeof createSubjectsRepo>;
export type FoldersRepo = ReturnType<typeof createFoldersRepo>;
