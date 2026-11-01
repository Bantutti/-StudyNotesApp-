/**
 * Contract test: P1 data -> P2a cloud docs (firebase/src/schemas on main).
 *
 * - Every local table row, mapped by toCloudDoc(), validates with P2a's own
 *   zod schema (the 1:1 table contract P2b's sync relies on).
 * - Every document P1 can produce passes P2a's noteDocumentSchema: the
 *   sample note, the long sample after ensureBlockIds, all 7 templates and
 *   Beautify Lite output (block ids live in attrs.blockId, decision Q7).
 * - Core's mirrored limits equal P2a's limits.ts.
 * toCloudDoc() is the reference row -> cloud mapping for P2b's sync module.
 */
import {
  createSeqIdGenerator,
  DOCUMENT_LIMITS,
  ENTITY_ID_PATTERN,
  ensureBlockIds,
  HEX6_PATTERN,
  ICON_PATTERN,
  LIST_LIMITS,
  makeLongSample,
  SAMPLE_NOTE,
  SETTINGS_MAX_CHARS,
  TEXT_LIMITS,
  type NoteDoc,
} from '@/core';
import { beautifyLite } from '@/modules/beautify';
import { createTemplateRegistry, instantiateTemplate } from '@/modules/templates';

import * as p2a from '../../../../firebase/src/schemas';
import type { SqlRow } from '../sql';
import { makeStore } from './helpers';

const UID = 'test-uid-0001';
const BOOL_FIELDS = new Set(['deleted', 'aiAllowed', 'autoMakeCards', 'sourceChanged', 'suspended', 'createdFromReference']);
const TIME_FIELDS = new Set(['created', 'updated', 'deletionRequestedAt', 'reviewedAt']);
const LIST_FIELDS: Record<string, 'time' | 'plain'> = { examDates: 'time', tags: 'plain', bookmarks: 'plain' };
const LOCAL_ONLY = new Set(['localPath']);

const ts = (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000, toMillis: () => ms });

/** The row -> cloud doc mapping P2b's sync module must implement. */
export function toCloudDoc(row: SqlRow, uid: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (LOCAL_ONLY.has(k)) continue;
    if (k === 'owner') out[k] = uid;
    else if (k === 'rev') out[k] = Math.max(1, Number(v));
    else if (BOOL_FIELDS.has(k)) out[k] = v === 1;
    else if (TIME_FIELDS.has(k)) out[k] = v === null ? null : ts(Number(v));
    else if (k in LIST_FIELDS) {
      const list = JSON.parse(String(v)) as unknown[];
      out[k] = LIST_FIELDS[k] === 'time' ? list.map((x) => ts(Number(x))) : list;
    } else out[k] = v;
  }
  return out;
}

const docOk = (d: unknown) => {
  const r = p2a.noteDocumentSchema.safeParse(d);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return true;
};

describe('local rows match P2a cloud schemas', () => {
  it('every table row validates as its cloud document', async () => {
    const { store, driver } = await makeStore();
    const s = await store.subjects.create({ name: 'Biology 😀', color: '#4f7cf7', examDates: [Date.UTC(2026, 11, 1)] });
    const f = await store.folders.create({ subject: s.id, name: 'Week 1' });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', subject: s.id, folder: f.id, title: 'Osmosis', tags: ['exam', '😀😀'], document: SAMPLE_NOTE });
    await store.notes.create({ stylePackId: 'clear-read' });
    const gone = await store.notes.create({ stylePackId: 'clear-read', title: 'bye' });
    await store.notes.remove([gone.id]);
    const raw = driver.raw;
    raw.exec(`INSERT INTO cards (id, created, updated, subject, note, sourceBlockId, type, front, back, source)
      VALUES ('c_0000000000000901', 1, 2, '${s.id}', '${n.id}', 'b_sample000000003', 'basic', 'Osmosis', 'Water moves', 'definition')`);
    raw.exec(`INSERT INTO reviewLogs (id, created, card, rating, reviewedAt, device) VALUES ('r_0000000000000901', 3, 'c_0000000000000901', 3, 3, 'dev1')`);
    raw.exec(`INSERT INTO recordings (id, created, updated, note, duration, language, segments, bookmarks)
      VALUES ('rec_000000000000901', 1, 1, '${n.id}', 60000, 'en', '[{"id":"s1","start":0,"end":5000,"text":"hi"}]', '[1000,2000]')`);
    raw.exec(`INSERT INTO assets (id, created, updated, type, cloudPath, size, localPath) VALUES ('a_0000000000000901', 1, 1, 'audio', NULL, 1234, '/data/x.m4a')`);
    raw.exec(`INSERT INTO stylePacks (id, created, updated, version, definition) VALUES ('p_0000000000000901', 1, 1, 1, '{"schema":3}')`);
    raw.exec(`INSERT INTO templates (id, created, updated, version, definition) VALUES ('t_0000000000000901', 1, 1, 1, '{"id":"cornell"}')`);

    const pairs = [
      ['users', p2a.userSchema], ['subjects', p2a.subjectSchema], ['folders', p2a.folderSchema], ['notes', p2a.noteSchema],
      ['cards', p2a.cardSchema], ['reviewLogs', p2a.reviewLogSchema], ['recordings', p2a.recordingSchema],
      ['assets', p2a.assetSchema], ['stylePacks', p2a.stylePackSchema], ['templates', p2a.templateSchema],
    ] as const;
    for (const [table, schema] of pairs) {
      const rows = raw.prepare(`SELECT * FROM ${table}`).all() as SqlRow[];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const cloud = toCloudDoc({ ...row }, UID);
        if (table === 'users') cloud.id = UID;
        const r = (schema as { safeParse(v: unknown): { success: boolean; error?: { issues: unknown[] } } }).safeParse(cloud);
        if (!r.success) throw new Error(`${table} row failed: ${JSON.stringify(r.error?.issues)}`);
      }
    }
  });

  it('notes made from every template and Beautify Lite output store as valid cloud notes', async () => {
    const { store, driver } = await makeStore();
    const reg = createTemplateRegistry();
    for (const t of reg.list()) {
      await store.notes.create({ stylePackId: 'pastel-highlight', document: instantiateTemplate(t, { ids: createSeqIdGenerator(), dateText: 'Sunday, 1 November 2026' }) });
    }
    const messy: NoteDoc = {
      type: 'doc',
      content: ['NOTES:', 'Osmosis :: water moves', '- one', '- two', 'Q: why?', 'A: because', 'Tip: revise'].map((text) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] })),
    };
    const n = await store.notes.create({ stylePackId: 'clear-read', document: messy });
    const ids = createSeqIdGenerator();
    await store.notes.save(n.id, { document: beautifyLite((await store.notes.get(n.id))!.document, ids).doc });
    const rows = driver.raw.prepare('SELECT * FROM notes').all() as SqlRow[];
    expect(rows).toHaveLength(reg.list().length + 1);
    for (const row of rows) {
      const r = p2a.noteSchema.safeParse(toCloudDoc({ ...row }, UID));
      if (!r.success) throw new Error(JSON.stringify(r.error.issues));
    }
  });
});

describe('P1 documents pass P2a noteDocumentSchema (attrs.blockId)', () => {
  it('the sample note', () => expect(docOk(SAMPLE_NOTE)).toBe(true));

  it('the long sample once ensureBlockIds has run (and not before: its ids are null)', () => {
    const long = makeLongSample(25);
    expect(p2a.noteDocumentSchema.safeParse(long).success).toBe(false);
    expect(docOk(ensureBlockIds(long, createSeqIdGenerator()))).toBe(true);
  });

  it('all 7 templates', () => {
    const reg = createTemplateRegistry();
    expect(reg.list()).toHaveLength(7);
    for (const t of reg.list()) expect(docOk(instantiateTemplate(t, { ids: createSeqIdGenerator(), dateText: 'x' }))).toBe(true);
  });

  it('Beautify Lite output', () => {
    expect(docOk(beautifyLite(SAMPLE_NOTE, createSeqIdGenerator()).doc)).toBe(true);
  });

  it('a document using attrs.id instead of attrs.blockId is rejected', () => {
    const wrong = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'b_x' }, content: [{ type: 'text', text: 'x' }] }] };
    expect(p2a.noteDocumentSchema.safeParse(wrong).success).toBe(false);
  });
});

describe('core limits mirror P2a limits.ts', () => {
  it('uses the same numbers and patterns', () => {
    expect(TEXT_LIMITS).toEqual(p2a.TEXT);
    expect(LIST_LIMITS).toEqual(p2a.LISTS);
    expect(DOCUMENT_LIMITS.maxChars).toBe(p2a.JSON_CAPS.document);
    expect(DOCUMENT_LIMITS.maxBytes).toBe(p2a.JSON_CAPS.documentBytes);
    expect(SETTINGS_MAX_CHARS).toBe(p2a.JSON_CAPS.settings);
    expect(String(ENTITY_ID_PATTERN)).toBe(String(p2a.ENTITY_ID_PATTERN));
    expect(String(HEX6_PATTERN)).toBe(String(p2a.HEX6_PATTERN));
    expect(String(ICON_PATTERN)).toBe(String(p2a.ICON_PATTERN));
  });
});
