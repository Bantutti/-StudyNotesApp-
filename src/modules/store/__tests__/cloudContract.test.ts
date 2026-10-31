/**
 * Contract test: local rows -> P2a cloud docs.
 *
 * Maps every local table row to the cloud document P2b will upload and
 * validates it with P2a's own zod schemas (firebase/src/schemas). This
 * proves the tables are a 1:1 copy and that P1's documents (block ids in
 * attrs.blockId, decision Q7) pass the cloud checks.
 *
 * Runs only when firebase/ is in the tree (P2a merged into main); skipped
 * otherwise. toCloudDoc() is the reference mapping for P2b's sync module.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { SAMPLE_NOTE } from '@/core';

import type { SqlRow } from '../sql';
import { makeStore } from './helpers';

const SCHEMAS = join(__dirname, '../../../../firebase/src/schemas/index.ts');
const describeIfP2a = existsSync(SCHEMAS) ? describe : describe.skip;

const UID = 'test-uid-0001';
const BOOL_FIELDS = new Set(['deleted', 'aiAllowed', 'autoMakeCards', 'sourceChanged', 'suspended', 'createdFromReference']);
const TIME_FIELDS = new Set(['created', 'updated', 'deletionRequestedAt', 'reviewedAt']);
const LIST_FIELDS: Record<string, 'time' | 'plain'> = { examDates: 'time', tags: 'plain', bookmarks: 'plain' };
const LOCAL_ONLY = new Set(['localPath']);

const ts = (ms: number) => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: (ms % 1000) * 1_000_000,
  toMillis: () => ms,
});

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

describeIfP2a('local rows match P2a cloud schemas', () => {
  it('every table row validates as its cloud document', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional module, present only after P2a merges
    const p2a = require(SCHEMAS) as Record<string, { safeParse(v: unknown): { success: boolean; error?: { issues: unknown[] } } }>;
    const { store, driver } = await makeStore();
    const s = await store.subjects.create({ name: 'Biology 😀', color: '#4f7cf7', examDates: [Date.UTC(2026, 11, 1)] });
    const f = await store.folders.create({ subject: s.id, name: 'Week 1' });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', subject: s.id, folder: f.id, title: 'Osmosis', tags: ['exam'], document: SAMPLE_NOTE });
    const empty = await store.notes.create({ stylePackId: 'clear-read' });
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

    const pairs: [string, string][] = [
      ['users', 'userSchema'], ['subjects', 'subjectSchema'], ['folders', 'folderSchema'], ['notes', 'noteSchema'],
      ['cards', 'cardSchema'], ['reviewLogs', 'reviewLogSchema'], ['recordings', 'recordingSchema'],
      ['assets', 'assetSchema'], ['stylePacks', 'stylePackSchema'], ['templates', 'templateSchema'],
    ];
    for (const [table, schemaName] of pairs) {
      const rows = raw.prepare(`SELECT * FROM ${table}`).all() as SqlRow[];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const docObj = toCloudDoc({ ...row }, UID);
        if (table === 'users') docObj.id = UID;
        const r = p2a[schemaName]!.safeParse(docObj);
        if (!r.success) throw new Error(`${table} row failed ${schemaName}: ${JSON.stringify(r.error?.issues)}`);
      }
    }
    expect(empty.id).toBeTruthy();
  });

  it('a document that uses attrs.id instead of attrs.blockId is rejected by the cloud schema', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
    const { noteDocumentSchema } = require(SCHEMAS) as { noteDocumentSchema: { safeParse(v: unknown): { success: boolean } } };
    const wrong = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'b_x' }, content: [{ type: 'text', text: 'x' }] }] };
    expect(noteDocumentSchema.safeParse(wrong).success).toBe(false);
    expect(noteDocumentSchema.safeParse(SAMPLE_NOTE).success).toBe(true);
  });
});
