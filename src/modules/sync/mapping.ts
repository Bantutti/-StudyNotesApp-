/**
 * Local row <-> cloud document mapping (P1's reference `toCloudDoc`,
 * promoted from its contract test into the sync module).
 *
 * Local format (store): timestamps are integer ms, booleans are 0/1, lists
 * are JSON text, owner is null while a guest, rev 0 = never uploaded, and
 * the profile row's id is 'local'.
 * Cloud format (P2a collections.ts): Timestamps, booleans, arrays, owner =
 * uid, users/{uid}. assets.localPath never leaves the device.
 */
import { EMPTY_DOC_JSON } from '@/core';
import { LOCAL_USER_ID, TABLE_COLUMNS, WIPED_NAME, type SqlRow, type SyncTable } from '@/modules/store';

import type { TimestampLike } from './cloudSchemas';
import { SERVER_TIME, type CloudCollection, type RemoteWrite } from './ports';
import { CloudTime, isTimestampLike } from './time';

const BOOL_FIELDS = new Set(['deleted', 'aiAllowed', 'autoMakeCards', 'sourceChanged', 'suspended', 'createdFromReference']);
const TIME_FIELDS = new Set(['created', 'updated', 'deletionRequestedAt', 'reviewedAt']);
const TIME_LIST_FIELDS = new Set(['examDates']);
const JSON_LIST_FIELDS = new Set(['tags', 'bookmarks']);
const LOCAL_ONLY = new Set(['localPath']);

export const collectionOf = (tbl: SyncTable): CloudCollection => tbl;
export const docIdOf = (tbl: SyncTable, row: SqlRow, uid: string): string => (tbl === 'users' ? uid : String(row.id));

function parseList(v: unknown): unknown[] {
  if (typeof v !== 'string') return [];
  try {
    const p: unknown = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

/**
 * The full cloud document for a local row, with real timestamps (CloudTime)
 * instead of server-time placeholders. Used to validate an upload with
 * P2a's zod schema and to hash what was sent.
 */
export function toCloudDoc(tbl: SyncTable, row: SqlRow, uid: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TABLE_COLUMNS[tbl]) {
    if (LOCAL_ONLY.has(k)) continue;
    const v = row[k];
    if (k === 'owner') out[k] = uid;
    else if (k === 'id') out[k] = docIdOf(tbl, row, uid);
    else if (BOOL_FIELDS.has(k)) out[k] = v === 1 || v === true;
    else if (TIME_FIELDS.has(k)) out[k] = v === null || v === undefined ? null : CloudTime.fromMillis(Number(v));
    else if (TIME_LIST_FIELDS.has(k)) out[k] = parseList(v).map((x) => CloudTime.fromMillis(Number(x)));
    else if (JSON_LIST_FIELDS.has(k)) out[k] = parseList(v);
    else out[k] = v ?? null;
  }
  return out;
}

/** A pulled cloud document as a local row (the inverse of toCloudDoc). */
export function fromCloudDoc(tbl: SyncTable, data: Record<string, unknown>): SqlRow {
  const out: SqlRow = {};
  for (const k of TABLE_COLUMNS[tbl]) {
    if (LOCAL_ONLY.has(k)) continue;
    const v = data[k];
    if (k === 'id' && tbl === 'users') out[k] = LOCAL_USER_ID;
    else if (BOOL_FIELDS.has(k)) out[k] = v === true ? 1 : 0;
    else if (TIME_FIELDS.has(k)) out[k] = isTimestampLike(v) ? v.toMillis() : null;
    else if (TIME_LIST_FIELDS.has(k)) out[k] = JSON.stringify((Array.isArray(v) ? v : []).filter(isTimestampLike).map((t) => t.toMillis()));
    else if (JSON_LIST_FIELDS.has(k)) out[k] = JSON.stringify(Array.isArray(v) ? v : []);
    else out[k] = v === undefined ? null : (v as SqlRow[string]);
  }
  return out;
}

/** Placeholder front for an erased card (the cloud requires 1+ characters). */
export const ERASED_CARD_FRONT = WIPED_NAME;
export const ERASED_COLOR = 'CCCCCC';

/**
 * "Deleted means deleted" (C1): a tombstone keeps only ids, timestamps and
 * required keys. Everything a person wrote is erased before it is uploaded,
 * and the same erased row is then kept locally.
 */
export function eraseRow(tbl: SyncTable, row: SqlRow): SqlRow {
  const r: SqlRow = { ...row, deleted: 1 };
  switch (tbl) {
    case 'notes':
      return { ...r, document: EMPTY_DOC_JSON, title: '', tags: '[]', inkLayerRef: null, subject: null, folder: null, templateId: null };
    case 'subjects':
      return { ...r, name: WIPED_NAME, color: ERASED_COLOR, icon: 'book', defaultPack: null, defaultTemplate: null, examDates: '[]', aiAllowed: 1, autoMakeCards: 0 };
    case 'folders':
      return { ...r, name: WIPED_NAME, subject: null, parent: null };
    case 'cards':
      return { ...r, front: ERASED_CARD_FRONT, back: '', subject: null, note: null, sourceBlockId: null, sourceChanged: 0, suspended: 0 };
    case 'recordings':
      return { ...r, asset: null, duration: 0, language: null, segments: '[]', bookmarks: '[]' };
    case 'assets':
      return { ...r, cloudPath: null, size: 0 };
    case 'stylePacks':
      return { ...r, definition: '{}', createdFromReference: 0 };
    case 'templates':
      return { ...r, definition: '{}' };
    case 'users':
    case 'reviewLogs':
      return row; // never tombstoned
  }
}

export interface PlannedWrite {
  write: RemoteWrite;
  /** The full document as it will exist after the write (server times = `now`). For zod and hashing. */
  expected: Record<string, unknown>;
  /** rev the doc will have after the write (review logs: 1). */
  sentRev: number;
}

/**
 * Builds the write for one local row (P2a MERGE_NOTES §6.5):
 * - never uploaded (rev 0): a full `set` with rev 1 and server times;
 * - otherwise an `update` with rev = local rev + 1 and a new server time
 *   for `updated`. `id`, `owner` and `created` are never resent: the
 *   stored `created` has microseconds that the local ms copy lacks, and the
 *   rules require it unchanged.
 * - review logs: create-only `set`.
 */
export function planWrite(tbl: SyncTable, row: SqlRow, uid: string, now: TimestampLike): PlannedWrite {
  const collection = collectionOf(tbl);
  const id = docIdOf(tbl, row, uid);
  const full = toCloudDoc(tbl, row, uid);
  const rev = Number(row.rev ?? 0);

  if (tbl === 'reviewLogs') {
    return { write: { op: 'set', collection, id, data: { ...full, created: SERVER_TIME } }, expected: { ...full, created: now }, sentRev: 1 };
  }
  if (rev === 0) {
    const data: Record<string, unknown> = { ...full, created: SERVER_TIME, updated: SERVER_TIME, rev: 1 };
    if (tbl === 'users') data.deletionRequestedAt = null;
    return { write: { op: 'set', collection, id, data }, expected: { ...data, created: now, updated: now }, sentRev: 1 };
  }
  const data: Record<string, unknown> = { ...full, updated: SERVER_TIME, rev: rev + 1 };
  delete data.id;
  delete data.owner;
  delete data.created;
  if (tbl === 'users') delete data.deletionRequestedAt; // only account deletion touches it
  return {
    write: { op: 'update', collection, id, data },
    expected: { ...full, updated: now, rev: rev + 1 },
    sentRev: rev + 1,
  };
}

/** Fields that describe content (not lifecycle), for "is this server copy the one I sent?". */
const LIFECYCLE = new Set(['created', 'updated', 'rev', 'owner', 'id', 'schemaVersion', 'deletionRequestedAt']);

/** Stable JSON of a doc's content fields: timestamps as ms, keys sorted. */
export function contentKey(doc: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => {
    if (isTimestampLike(v)) return { $t: v.toMillis() };
    if (Array.isArray(v)) return v.map(norm);
    return v;
  };
  const keys = Object.keys(doc).filter((k) => !LIFECYCLE.has(k)).sort();
  return JSON.stringify(keys.map((k) => [k, norm(doc[k])]));
}
