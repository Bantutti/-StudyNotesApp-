/**
 * Preparing a document for storage (SQLite now, the cloud from P2b).
 *
 * Every save goes through prepareDocForSave():
 *  1. validate against the app's document schema (untrusted input),
 *  2. ensureBlockIds(): every block gets a valid, unique, non-null blockId
 *     (existing ids are kept), which is what P2a's cloud check requires,
 *  3. serialize and enforce the CLOUD caps (600,000 chars, 900,000 UTF-8
 *     bytes), so a note that saves locally can always sync.
 */
import { AppError } from '../errors';
import type { IdGenerator } from '../ids';
import { DOCUMENT_LIMITS } from '../limits';
import { fail, ok, utf8Length, type Result } from '../validation';
import { ensureBlockIds } from './blockIds';
import { validateNoteDoc } from './parse';
import type { NoteDoc } from './schema';

/** The document kept on a deleted note after its text is wiped (decision Q11). */
export const EMPTY_DOC_JSON = '{"type":"doc","content":[]}';

export interface PreparedDoc {
  doc: NoteDoc;
  json: string;
  /** Share of the tighter cloud cap used (0..1). The editor warns above warnRatio. */
  usage: number;
}

export function documentUsage(json: string): number {
  return Math.max(json.length / DOCUMENT_LIMITS.maxChars, utf8Length(json) / DOCUMENT_LIMITS.maxBytes);
}

export function prepareDocForSave(raw: unknown, ids: IdGenerator): Result<PreparedDoc> {
  const valid = validateNoteDoc(raw);
  if (!valid.ok) return valid;
  const doc = ensureBlockIds(valid.value, ids);
  const json = JSON.stringify(doc);
  const usage = documentUsage(json);
  if (usage > 1) return fail(new AppError('too_large', 'This note is too long to save. Split it into two notes.'));
  return ok({ doc, json, usage });
}

/** A new note's starting document: one empty paragraph with its own id. */
export function emptyNoteDoc(ids: IdGenerator): NoteDoc {
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: ids.newId('b') } }] };
}
