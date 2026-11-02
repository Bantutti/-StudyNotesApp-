import { createLogger, createSeqIdGenerator, listBlockIds, memorySink, SAMPLE_NOTE } from '@/core';
import { openStore } from '@/modules/store';
import { createTemplateRegistry } from '@/modules/templates';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { isOnboarded } from '../appData';
import {
  applyPackToNote,
  applyTemplateToNote,
  setSubjectPack,
  createNoteIn,
  daysUntil,
  displayTitle,
  examLabel,
  finishOnboarding,
  formatExamDate,
  homeSummary,
  packForNewNote,
  parseExamDate,
  relativeTime,
  rememberOpenedNote,
  SAMPLE_TAG,
  skipOnboarding,
} from '../useCases';

const NOW = new Date(2026, 10, 1, 9, 0).getTime(); // 1 Nov 2026, 09:00 local
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

async function store() {
  let t = NOW;
  const s = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }), now: () => t++ });
  return s;
}

describe('onboarding (plan Flow 1)', () => {
  it('saves the look, creates the first subject and a Sample note in it', async () => {
    const s = await store();
    const noteId = await finishOnboarding(s, { packId: 'clear-read', subject: { name: 'Biology', color: '#2E9E6A', examDate: at(2026, 11, 10) } });
    expect(await isOnboarded(s)).toBe(true);
    expect((await s.settings.get()).defaultPack).toBe('clear-read');
    const [subject] = await s.subjects.list();
    expect(subject).toMatchObject({ name: 'Biology', color: '2E9E6A', examDates: [at(2026, 11, 10)] });
    const note = await s.notes.get(noteId);
    expect(note).toMatchObject({ subject: subject!.id, stylePackId: 'clear-read', tags: [SAMPLE_TAG] });
    expect(listBlockIds(note!.document)).toEqual(listBlockIds(SAMPLE_NOTE));
  });

  it('skipping the subject puts the sample in the Inbox', async () => {
    const s = await store();
    const noteId = await finishOnboarding(s, { packId: 'pastel-highlight', subject: null });
    expect((await s.notes.get(noteId))?.subject).toBeNull();
    expect(await s.subjects.list()).toHaveLength(0);
  });

  it('Skip lands on an empty app, onboarded, with no notes', async () => {
    const s = await store();
    await skipOnboarding(s);
    expect(await isOnboarded(s)).toBe(true);
    expect((await homeSummary(s, NOW)).hasAnyNote).toBe(false);
  });

  it('ignores an unknown pack id', async () => {
    const s = await store();
    await finishOnboarding(s, { packId: 'not-a-p1-pack', subject: null });
    expect((await s.settings.get()).defaultPack).toBe('pastel-highlight');
  });
});

describe('new notes use the right pack', () => {
  it('subject default > user default > Pastel Highlight', async () => {
    const s = await store();
    expect(await packForNewNote(s, null)).toBe('pastel-highlight');
    await s.settings.update({ defaultPack: 'clear-read' });
    expect(await packForNewNote(s, null)).toBe('clear-read');
    const sub = await s.subjects.create({ name: 'Art', color: '111111', defaultPack: 'pastel-highlight' });
    const n = await createNoteIn(s, { subject: sub.id });
    expect(n.stylePackId).toBe('pastel-highlight');
    const inbox = await createNoteIn(s, { subject: null });
    expect(inbox.stylePackId).toBe('clear-read');
  });
});

describe('home summary', () => {
  it('shows continue, recent notes and upcoming exams in order', async () => {
    const s = await store();
    const bio = await s.subjects.create({ name: 'Biology', color: '2E9E6A', examDates: [at(2026, 10, 20), at(2026, 11, 10)] }); // one past, one in 9 days
    await s.subjects.create({ name: 'Chem', color: '111111', examDates: [at(2026, 11, 1)] }); // today
    await s.subjects.create({ name: 'Far', color: '222222', examDates: [at(2027, 6, 1)] }); // beyond 60 days
    const a = await createNoteIn(s, { subject: bio.id }, { title: 'A' });
    await createNoteIn(s, { subject: bio.id }, { title: 'B' });
    await rememberOpenedNote(s, a.id);
    const h = await homeSummary(s, NOW);
    expect(h.continueNote?.id).toBe(a.id);
    expect(h.recent.map((n) => n.title)).toEqual(['B']);
    expect(h.exams.map(examLabel)).toEqual(['Chem exam is today', 'Biology exam in 9 days']);
    expect(h.hasAnyNote).toBe(true);
  });

  it('forgets a continue note that was deleted', async () => {
    const s = await store();
    const a = await createNoteIn(s, { subject: null }, { title: 'A' });
    await rememberOpenedNote(s, a.id);
    await s.notes.remove([a.id]);
    expect((await homeSummary(s, NOW)).continueNote).toBeNull();
  });
});

describe('formatting and parsing', () => {
  it('parses exam dates strictly', () => {
    expect(parseExamDate('', NOW)).toBeNull();
    expect(formatExamDate(parseExamDate('2026-12-15', NOW)!)).toBe('2026-12-15');
    expect(formatExamDate(parseExamDate(' 2026-11-1 ', NOW)!)).toBe('2026-11-01'); // today is allowed
    for (const bad of ['15/12/2026', '2026-02-30', '2026-10-31', '2031-01-01', 'tomorrow']) {
      expect(() => parseExamDate(bad, NOW)).toThrow();
    }
  });

  it('counts calendar days, not 24-hour blocks', () => {
    expect(daysUntil(new Date(2026, 10, 2, 0, 30).getTime(), new Date(2026, 10, 1, 23, 30).getTime())).toBe(1);
  });

  it('shows a title, else the first line, else Untitled', () => {
    expect(displayTitle({ title: 'Cells', preview: 'x' })).toBe('Cells');
    expect(displayTitle({ title: ' ', preview: 'Mitosis basics' })).toBe('Mitosis basics');
    expect(displayTitle({ title: '', preview: '' })).toBe('Untitled');
  });

  it('formats relative times', () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe('Just now');
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe('2 h ago');
    expect(relativeTime(at(2026, 10, 31, 20), NOW)).toBe('Yesterday');
    expect(relativeTime(at(2026, 10, 3), NOW)).toBe('3 Oct');
    expect(relativeTime(at(2025, 10, 3), NOW)).toBe('3 Oct 2025');
  });
});

describe('templates in use cases', () => {
  const deps = () => ({ templates: createTemplateRegistry(), ids: createSeqIdGenerator(), now: () => NOW });

  it("a new note in a subject uses the subject's default template", async () => {
    const s = await store();
    const sub = await s.subjects.create({ name: 'Bio', color: '111111', defaultTemplate: 'cornell' });
    const n = await createNoteIn(s, { subject: sub.id }, {}, deps());
    expect(n.templateId).toBe('cornell');
    expect(n.document.content.some((b) => b.type === 'columns')).toBe(true);
    const plain = await createNoteIn(s, { subject: null }, {}, deps());
    expect(plain.templateId).toBeNull();
  });

  it('applying a template saves a version first and keeps existing ids', async () => {
    const s = await store();
    const n = await createNoteIn(s, { subject: null }, { document: SAMPLE_NOTE });
    const r = await applyTemplateToNote(s, n.id, 'outline', deps());
    expect(r.note.templateId).toBe('outline');
    const after = await s.notes.get(n.id);
    expect(listBlockIds(after!.document).slice(0, listBlockIds(SAMPLE_NOTE).length)).toEqual(listBlockIds(SAMPLE_NOTE));
    expect((await s.versions.list(n.id))[0]?.reason).toBe('before_template');
    await expect(applyTemplateToNote(s, n.id, 'nope', deps())).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('style (M9)', () => {
  it('switching the look saves a version, keeps ids and content, and refuses unknown packs', async () => {
    const s = await store();
    const n = await createNoteIn(s, { subject: null }, { document: SAMPLE_NOTE });
    expect(await applyPackToNote(s, n.id, 'clear-read')).toBe(true);
    expect(await applyPackToNote(s, n.id, 'clear-read')).toBe(false); // already
    const after = await s.notes.get(n.id);
    expect(after).toMatchObject({ stylePackId: 'clear-read' });
    expect(after!.document).toEqual(n.document);
    expect((await s.versions.list(n.id)).map((v) => v.reason)).toEqual(['before_pack']);
    // P5: all 13 v1 packs are offered; unknown ids are still refused.
    await expect(applyPackToNote(s, n.id, 'dark-academia')).resolves.toBe(true);
    await expect(applyPackToNote(s, n.id, 'no-such-pack')).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('can set the look for a subject', async () => {
    const s = await store();
    const sub = await s.subjects.create({ name: 'Bio', color: '111111' });
    await setSubjectPack(s, sub.id, 'clear-read');
    expect(await packForNewNote(s, sub.id)).toBe('clear-read');
  });
});
