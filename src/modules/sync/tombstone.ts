/**
 * After a tombstone is accepted by the cloud (by any path: a normal upload,
 * a recognised lost ack, or our own write seen again in a pull), the same
 * erased row is kept on this device: deleted text must not linger locally
 * either (C1 "deleted means deleted", plan §17). Skipped while a newer local
 * edit is queued (e.g. the note was restored in the meantime).
 */
import { LOCAL_ONLY_COLUMNS, TABLE_COLUMNS, type SqlRow, type SyncOps, type SyncTable } from '@/modules/store';

import { eraseRow } from './mapping';

/** The row without local-only columns (applyRemote refuses them). */
export function cloudColumnsOnly(tbl: SyncTable, row: SqlRow): SqlRow {
  const localOnly = LOCAL_ONLY_COLUMNS[tbl] ?? [];
  const out: SqlRow = {};
  for (const c of TABLE_COLUMNS[tbl]) if (!localOnly.includes(c) && c in row) out[c] = row[c];
  return out;
}

export async function eraseLocalTombstone(s: SyncOps, tbl: SyncTable, id: string): Promise<void> {
  if (tbl === 'users' || tbl === 'reviewLogs') return;
  const row = await s.readRow(tbl, id);
  if (!row || row.deleted !== 1) return;
  if (await s.getOutbox(tbl, id)) return;
  const erased = eraseRow(tbl, row);
  if (JSON.stringify(cloudColumnsOnly(tbl, erased)) === JSON.stringify(cloudColumnsOnly(tbl, row))) return;
  await s.applyRemote(tbl, cloudColumnsOnly(tbl, erased));
}
