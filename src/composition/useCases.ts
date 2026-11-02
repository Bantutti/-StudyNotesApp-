/**
 * App use cases: the logic behind screens, kept out of components so it
 * is unit-tested against a real SQLite store. Screens call these and render.
 */
import * as z from 'zod';

import { AppError, firstLine, SAMPLE_NOTE, SAMPLE_NOTE_TITLE, t, type IdGenerator, type NoteDoc } from '@/core';
import type { Note, NoteListItem, SaveResult, Store, Subject } from '@/modules/store';
import { DEFAULT_PACK_ID, isBuiltInPackId, isCustomPackId } from '@/modules/stylepacks';
import { applyTemplateTo, formatTemplateDate, instantiateTemplate, type TemplateRegistry } from '@/modules/templates';

import { KEY_LAST_NOTE, KEY_ONBOARDED, KV_APP } from './appData';
import { packIsAvailable } from './customPacks';

export const SAMPLE_TAG = 'sample';
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

/** Pack for a new note: subject default > user default > Pastel Highlight. */
export async function packForNewNote(store: Store, subjectId: string | null): Promise<string> {
  if (subjectId) {
    const s = await store.subjects.get(subjectId);
    if (s?.defaultPack && isOfferedPack(s.defaultPack)) return s.defaultPack;
  }
  const settings = await store.settings.get();
  return settings.defaultPack && isOfferedPack(settings.defaultPack) ? settings.defaultPack : DEFAULT_PACK_ID;
}

/**
 * Packs a note, subject or the default may point at (P5): the 13 v1 packs,
 * or a custom pack id ("ref-..."). A custom id whose pack was deleted still
 * renders safely: the registry falls back to the default pack.
 */
export const isOfferedPack = (id: string): boolean => isBuiltInPackId(id) || isCustomPackId(id);

// ---------------------------------------------------------------------------
// Onboarding (plan Flow 1)
// ---------------------------------------------------------------------------

export interface FirstSubjectInput {
  name: string;
  color: string;
  examDate?: number | null;
}

/**
 * Finishes onboarding: saves the chosen look, creates the first subject (if
 * given) and the Sample note inside it, and marks onboarding done.
 * Returns the sample note's id (the app opens it). Skipping the subject step
 * still creates the sample note, in the Inbox.
 */
export async function finishOnboarding(store: Store, input: { packId: string; subject: FirstSubjectInput | null }): Promise<string> {
  const packId = isOfferedPack(input.packId) ? input.packId : DEFAULT_PACK_ID;
  await store.settings.update({ defaultPack: packId });
  let subject: Subject | null = null;
  if (input.subject) {
    subject = await store.subjects.create({
      name: input.subject.name,
      color: input.subject.color,
      examDates: input.subject.examDate ? [input.subject.examDate] : [],
    });
  }
  const note = await createSampleNote(store, subject?.id ?? null, packId);
  await store.kv.set(KV_APP, KEY_ONBOARDED, true);
  return note.id;
}

/** Skip at any step: lands on an empty Home with the "Create your first note" card (plan Flow 1). */
export async function skipOnboarding(store: Store, packId?: string): Promise<void> {
  if (packId && isOfferedPack(packId)) await store.settings.update({ defaultPack: packId });
  await store.kv.set(KV_APP, KEY_ONBOARDED, true);
}

export function createSampleNote(store: Store, subjectId: string | null, packId: string): Promise<Note> {
  return store.notes.create({
    subject: subjectId,
    title: SAMPLE_NOTE_TITLE,
    document: SAMPLE_NOTE,
    stylePackId: packId,
    tags: [SAMPLE_TAG],
  });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export interface TemplateDeps {
  templates: TemplateRegistry;
  ids: IdGenerator;
  now?: () => number;
}

/**
 * Creates a note in a subject/folder (or the Inbox) with the subject's
 * default pack. With template deps, a subject's default template is used
 * when no explicit document or template is given (plan Flow 2).
 */
export async function createNoteIn(
  store: Store,
  where: { subject: string | null; folder?: string | null },
  extra: { document?: NoteDoc; templateId?: string | null; title?: string } = {},
  deps?: TemplateDeps,
): Promise<Note> {
  let document = extra.document;
  let templateId = extra.templateId ?? null;
  if (deps && !document) {
    if (templateId === null && where.subject) templateId = (await store.subjects.get(where.subject))?.defaultTemplate ?? null;
    const t = templateId ? deps.templates.get(templateId) : undefined;
    if (t) document = instantiateTemplate(t, { ids: deps.ids, dateText: formatTemplateDate((deps.now ?? Date.now)()) });
    else templateId = null;
  }
  return store.notes.create({
    subject: where.subject,
    folder: where.folder ?? null,
    stylePackId: await packForNewNote(store, where.subject),
    document,
    templateId,
    title: extra.title,
  });
}

/**
 * Applies a template to an existing note. Saves a "Before template" version
 * first; existing blocks keep their ids, new sections get fresh ones.
 */
export async function applyTemplateToNote(store: Store, noteId: string, templateId: string, deps: TemplateDeps): Promise<SaveResult> {
  const t = deps.templates.get(templateId);
  if (!t) throw new AppError('not_found', 'That template is not available.');
  const note = await store.notes.get(noteId);
  if (!note || note.deleted) throw new AppError('not_found', 'This note no longer exists.');
  const doc = applyTemplateTo(note.document, t, { ids: deps.ids, dateText: formatTemplateDate((deps.now ?? Date.now)()) });
  return store.notes.save(noteId, { document: doc, templateId: t.id }, { before: 'before_template' });
}

export const rememberOpenedNote = (store: Store, noteId: string) => store.kv.set(KV_APP, KEY_LAST_NOTE, noteId);

/** Title to show: the title, else the first line, else "Untitled". */
export function displayTitle(n: { title: string; preview?: string; document?: NoteDoc }): string {
  if (n.title.trim()) return n.title;
  const line = n.preview ?? (n.document ? firstLine(n.document) : '');
  return line.trim() || t('common.untitled');
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export interface ExamCountdown {
  subjectId: string;
  subject: string;
  color: string;
  date: number;
  days: number;
}

export interface HomeSummary {
  continueNote: NoteListItem | null;
  recent: NoteListItem[];
  exams: ExamCountdown[];
  hasAnyNote: boolean;
}

/** Whole days from today to the exam day, in the phone's local calendar. */
export function daysUntil(date: number, now: number): number {
  const a = new Date(now);
  const b = new Date(date);
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((startB - startA) / DAY);
}

export async function homeSummary(store: Store, now: number, opts: { recent?: number; examHorizonDays?: number } = {}): Promise<HomeSummary> {
  const recent = await store.notes.recent(opts.recent ?? 6);
  const lastId = await store.kv.get(KV_APP, KEY_LAST_NOTE, z.string().max(80));
  let continueNote: NoteListItem | null = null;
  if (lastId) {
    continueNote = recent.find((n) => n.id === lastId) ?? null;
    if (!continueNote) {
      const n = await store.notes.get(lastId).catch(() => null);
      if (n && !n.deleted) continueNote = { ...n, preview: firstLine(n.document) };
    }
  }
  const horizon = opts.examHorizonDays ?? 60;
  const exams: ExamCountdown[] = [];
  for (const s of await store.subjects.list()) {
    const next = s.examDates.find((d) => daysUntil(d, now) >= 0);
    if (next === undefined) continue;
    const days = daysUntil(next, now);
    if (days <= horizon) exams.push({ subjectId: s.id, subject: s.name, color: s.color, date: next, days });
  }
  exams.sort((a, b) => a.days - b.days);
  return {
    continueNote,
    recent: recent.filter((n) => n.id !== continueNote?.id).slice(0, 5),
    exams,
    hasAnyNote: recent.length > 0,
  };
}

export function examLabel(e: ExamCountdown): string {
  return e.days === 0 ? t('home.examToday', { subject: e.subject }) : t('home.examIn', { subject: e.subject, days: e.days });
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * Parses an exam date typed as YYYY-MM-DD (local noon, so time zones never
 * shift the day). Empty text means "no exam date". Throws on anything else.
 */
export function parseExamDate(text: string, now: number): number | null {
  const s = text.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) throw new AppError('validation_failed', 'Type the exam date like 2026-12-15.');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 12);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    throw new AppError('validation_failed', 'That date does not exist.');
  }
  if (daysUntil(date.getTime(), now) < 0) throw new AppError('validation_failed', 'Pick a date that is not in the past.');
  if (daysUntil(date.getTime(), now) > 3 * 366) throw new AppError('validation_failed', 'Pick a date within the next three years.');
  return date.getTime();
}

export function formatExamDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "5 min ago", "Yesterday", "3 Nov": short relative time for note cards. */
export function relativeTime(ms: number, now: number): string {
  const diff = now - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  const days = daysUntil(now, ms); // calendar days between
  if (days === 0) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (days === 1) return 'Yesterday';
  const d = new Date(ms);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return new Date(now).getFullYear() === d.getFullYear() ? `${d.getDate()} ${month}` : `${d.getDate()} ${month} ${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Style (M9)
// ---------------------------------------------------------------------------

/**
 * Switches a note's style pack. Content and block ids are untouched (a pack
 * is only CSS variables); a "Before style change" version is saved first.
 * Returns false when the note already uses that pack.
 */
export async function applyPackToNote(store: Store, noteId: string, packId: string): Promise<boolean> {
  if (!(await packIsAvailable(store, packId, isBuiltInPackId))) throw new AppError('validation_failed', 'That look is not available yet.');
  const note = await store.notes.get(noteId);
  if (!note || note.deleted) throw new AppError('not_found', 'This note no longer exists.');
  if (note.stylePackId === packId) return false;
  await store.notes.save(noteId, { stylePackId: packId }, { before: 'before_pack' });
  return true;
}

/** "Use for this subject": new notes in the subject start with this pack. */
export async function setSubjectPack(store: Store, subjectId: string, packId: string): Promise<void> {
  if (!(await packIsAvailable(store, packId, isBuiltInPackId))) throw new AppError('validation_failed', 'That look is not available yet.');
  await store.subjects.update(subjectId, { defaultPack: packId });
}
