/**
 * Validation at the cloud boundary (rule 1, P2a SECURITY_REVIEW §S.3).
 *
 * - Outgoing: the exact document an upload will create is checked with
 *   P2a's zod schema first, so the rules never see invalid data and a bad
 *   row is quarantined instead of retried forever.
 * - Incoming: every pulled document is checked with the same schema
 *   (including the JSON strings: note tree, segments, definitions) AND with
 *   the app's own document schema, because the app must be able to open
 *   it. Anything that fails is quarantined and never rendered.
 * Reasons are field paths only ("schema:title"), never values.
 */
import { parseNoteDocJson } from '@/core';
import type { SqlRow, SyncTable } from '@/modules/store';

import { COLLECTION_SCHEMAS, userSchema } from './cloudSchemas';
import { fromCloudDoc } from './mapping';
import type { RemoteDoc } from './ports';

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

interface SafeParser {
  safeParse(v: unknown): { success: boolean; error?: { issues: { path: PropertyKey[] }[] } };
}

const schemaOf = (tbl: SyncTable): SafeParser => (tbl === 'users' ? userSchema : COLLECTION_SCHEMAS[tbl]) as SafeParser;

function reasonOf(r: ReturnType<SafeParser['safeParse']>): string {
  const path = r.error?.issues[0]?.path ?? [];
  const field = path.filter((p) => typeof p === 'string').join('.') || 'doc';
  return `schema:${field}`.slice(0, 60);
}

export function checkOutgoing(tbl: SyncTable, expected: Record<string, unknown>): Checked<true> {
  const r = schemaOf(tbl).safeParse(expected);
  return r.success ? { ok: true, value: true } : { ok: false, reason: reasonOf(r) };
}

export function checkIncoming(tbl: SyncTable, doc: RemoteDoc, uid: string): Checked<SqlRow> {
  const data = doc.data;
  // Defense in depth: the rules already scope reads to the caller.
  if (data.owner !== uid) return { ok: false, reason: 'owner' };
  if (data.id !== doc.id) return { ok: false, reason: 'id' };
  const r = schemaOf(tbl).safeParse(data);
  if (!r.success) return { ok: false, reason: reasonOf(r) };
  const row = fromCloudDoc(tbl, data);
  if (tbl === 'notes' && !parseNoteDocJson(String(row.document)).ok) return { ok: false, reason: 'document' };
  return { ok: true, value: row };
}
