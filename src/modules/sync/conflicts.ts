/**
 * The Conflict resolver's actions (plan F1: "Keep mine, Keep other, Keep
 * both"; decision Q5). Before any choice, both versions of a note are saved
 * in History as "Before sync merge", so no choice can lose work.
 *
 * - mine:  my version is uploaded on top of the server copy (rev = server
 *          rev + 1). For "deleted here, edited there" this keeps it deleted.
 * - other: the server copy replaces mine on this device.
 * - both:  (notes only) the server copy replaces mine, and mine is saved as
 *          a new note "<title> (copy from this phone)".
 */
import { AppError, TEXT_LIMITS, type IdGenerator } from '@/core';
import type { ConflictRecord, SqlRow, SyncTable } from '@/modules/store';

import type { LocalReplica } from './ports';

export type ConflictChoice = 'mine' | 'other' | 'both';

export const COPY_SUFFIX = ' (copy from this phone)';

/** "<title> (copy from this phone)", cut so it stays within the cloud title cap (UTF-16 units). */
export function copyTitle(title: string): string {
  const room = TEXT_LIMITS.noteTitle - COPY_SUFFIX.length;
  let base = title.trim() || 'Untitled';
  if (base.length > room) {
    base = base.slice(0, room);
    // Don't leave half of a surrogate pair (an emoji) at the end.
    if (/[\uD800-\uDBFF]$/.test(base)) base = base.slice(0, -1);
  }
  return `${base}${COPY_SUFFIX}`;
}

export interface ConflictView {
  conflict: ConflictRecord;
  /** My current row (null if it was removed from this phone meanwhile). */
  mine: SqlRow | null;
}

export async function listConflicts(local: LocalReplica): Promise<ConflictView[]> {
  const list = await local.listConflicts();
  return Promise.all(list.map(async (conflict) => ({ conflict, mine: await local.readRow(conflict.tbl, conflict.id) })));
}

export async function resolveConflict(
  deps: { local: LocalReplica; ids: IdGenerator },
  tbl: SyncTable,
  id: string,
  choice: ConflictChoice,
): Promise<{ copyId: string | null }> {
  return deps.local.run(async (s) => {
    const c = (await s.listConflicts()).find((x) => x.tbl === tbl && x.id === id);
    if (!c) throw new AppError('not_found', 'This conflict was already resolved.');
    const mine = await s.readRow(tbl, id);
    if (choice === 'both' && (tbl !== 'notes' || c.kind !== 'edit_edit')) {
      throw new AppError('unsupported', 'Keep both is only for notes changed on two devices.');
    }
    if (tbl === 'notes') {
      if (mine) await s.snapshotRow(mine, deps.ids.newId('v'));
      await s.snapshotRow(c.serverRow, deps.ids.newId('v'));
    }
    let copyId: string | null = null;
    if (choice === 'mine' && mine) {
      await s.setLocalRev(tbl, id, c.serverRev);
      await s.requeue(tbl, id);
    } else {
      if (choice === 'both' && mine) {
        copyId = deps.ids.newId('n');
        await s.insertNoteCopy(mine, copyId, copyTitle(String(mine.title ?? '')));
      }
      await s.applyRemote(tbl, c.serverRow);
      await s.removeOutbox(tbl, id);
    }
    await s.removeConflict(tbl, id);
    return { copyId };
  });
}
