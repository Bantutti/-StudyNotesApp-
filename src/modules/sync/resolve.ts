/**
 * What to do when the server has a NEWER revision than the one a local
 * edit was based on (a stale write, found by a rejected upload or by a
 * pull). Shared by push and pull so both follow the same rules (Q4, Q5):
 *
 * - notes, cards, recordings -> a conflict for the resolver (keep mine,
 *   keep other, keep both). The local version stays on screen and its
 *   upload pauses until the user chooses.
 * - assets -> the server's doc is taken (unless deleted here); the file is
 *   reconciled by the asset pass (assets.ts, with optional mergers).
 * - everything else -> resolved automatically: a delete beats an edit,
 *   otherwise the local edit wins (it is re-sent on top of the server rev,
 *   i.e. the last push wins).
 * - users (the profile): on a device that never synced (local rev 0) the
 *   cloud profile wins; afterwards the local settings win.
 *
 * Every function here runs INSIDE one store transaction (SyncOps), so a
 * local edit can never slip in between the check and the write.
 */
import type { SqlRow, SyncOps, SyncTable } from '@/modules/store';

/** Tables whose conflicts go to the Conflict resolver screen (Q4). */
export const RESOLVER_TABLES: ReadonlySet<SyncTable> = new Set<SyncTable>(['notes', 'cards', 'recordings']);

export type StaleOutcome = 'conflict' | 'took_server' | 'local_wins' | 'both_deleted';

export async function resolveStale(s: SyncOps, tbl: SyncTable, localRow: SqlRow, serverRow: SqlRow): Promise<StaleOutcome> {
  const id = String(localRow.id);
  const serverRev = Number(serverRow.rev);
  const localDeleted = localRow.deleted === 1;
  const serverDeleted = serverRow.deleted === 1;

  if (tbl === 'users') {
    if (Number(localRow.rev) === 0) return takeServer(s, tbl, id, serverRow);
    await s.setLocalRev(tbl, id, serverRev);
    return 'local_wins';
  }

  if (localDeleted && serverDeleted) {
    await takeServer(s, tbl, id, serverRow);
    return 'both_deleted';
  }

  if (RESOLVER_TABLES.has(tbl)) {
    const kind = serverDeleted ? 'remote_deleted' : localDeleted ? 'local_deleted' : 'edit_edit';
    await s.putConflict({ tbl, id, kind, serverRev, serverRow });
    return 'conflict';
  }

  // Asset docs only describe their file (size, path): take the server's, and
  // let the asset pass decide about the file itself (download, merge with a
  // registered merger, or upload ours on top). A local delete still wins.
  if (tbl === 'assets' && !localDeleted) return takeServer(s, tbl, id, serverRow);

  // Metadata: a delete beats an edit; otherwise the local edit wins.
  if (serverDeleted && !localDeleted) return takeServer(s, tbl, id, serverRow);
  await s.setLocalRev(tbl, id, serverRev);
  return 'local_wins';
}

async function takeServer(s: SyncOps, tbl: SyncTable, id: string, serverRow: SqlRow): Promise<'took_server'> {
  await s.applyRemote(tbl, serverRow);
  await s.removeOutbox(tbl, id);
  await s.removeConflict(tbl, id);
  return 'took_server';
}
