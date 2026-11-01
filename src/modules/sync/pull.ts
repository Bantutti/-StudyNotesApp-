/**
 * Download: cloud -> device (docs/modules/sync.md "Pull").
 *
 * Per collection: owner == uid, `updated` (review logs: `created`) >= the
 * stored cursor minus a 60 s overlap, ordered by (time, doc id), paged.
 * Applying is idempotent (a doc whose rev is not newer than ours is
 * skipped), so the overlap only costs a few reads. Every doc is validated
 * first; invalid docs are quarantined and the cursor still moves on.
 *
 * A pulled doc is applied directly only when the row has no queued local
 * edit, checked inside the same transaction as the write. Otherwise it is
 * either our own earlier upload (lost ack) or a stale-write case for
 * resolveStale() (conflict, delete wins, or local wins).
 */
import type { SyncTable } from '@/modules/store';

import { COLLECTION_NAMES, type CollectionName, type TimestampLike } from './cloudSchemas';
import { AccountGoneError, contentHash, limitsOf, type SyncContext } from './context';
import type { RemoteDoc } from './ports';
import { resolveStale } from './resolve';
import { eraseLocalTombstone } from './tombstone';
import { CloudTime, compareTime, isTimestampLike } from './time';
import { checkIncoming } from './validate';

export interface PullReport {
  applied: number;
  skipped: number;
  conflicts: number;
  quarantined: number;
  /** Note ids changed by this pull (an open editor reloads them). */
  changedNotes: string[];
}

type ApplyOutcome = 'applied' | 'skipped' | 'conflict' | 'quarantined' | 'own';

/** Applies one pulled doc. Exported for the single-doc refresh when a note is opened. */
export async function applyIncoming(ctx: SyncContext, tbl: SyncTable, doc: RemoteDoc): Promise<ApplyOutcome> {
  const chk = checkIncoming(tbl, doc, ctx.uid);
  if (!chk.ok) {
    await ctx.local.quarantine({ tbl, id: doc.id, direction: 'in', reason: chk.reason });
    ctx.logger.warn('sync.pull_invalid', { tbl, reason: chk.reason });
    return 'quarantined';
  }
  const row = chk.value;
  const id = String(row.id);
  const inRev = Number(row.rev ?? 1);
  const hash = contentHash(doc.data);
  return ctx.local.run(async (s): Promise<ApplyOutcome> => {
    const localRow = await s.readRow(tbl, id);
    const item = await s.getOutbox(tbl, id);
    if (tbl === 'reviewLogs') {
      if (!localRow) {
        await s.applyRemote(tbl, row);
        return 'applied';
      }
      if (item) await s.markPushed(tbl, id, { sentSeq: item.seq, rev: 1, owner: ctx.uid }); // ours, already uploaded
      return 'skipped';
    }
    if (localRow && inRev <= Number(localRow.rev)) return 'skipped';
    if (!item || !localRow) {
      await s.applyRemote(tbl, row);
      if (item) await s.removeOutbox(tbl, id);
      return 'applied';
    }
    // The row has a queued local edit.
    if (item.sentRev === inRev && item.sentHash === hash) {
      await s.markPushed(tbl, id, { sentSeq: item.sentSeq ?? 0, rev: inRev, owner: ctx.uid });
      await eraseLocalTombstone(s, tbl, id);
      return 'own';
    }
    const outcome = await resolveStale(s, tbl, localRow, row);
    return outcome === 'conflict' ? 'conflict' : outcome === 'local_wins' ? 'skipped' : 'applied';
  });
}

function timeOf(doc: RemoteDoc, field: 'updated' | 'created'): TimestampLike | null {
  const t = doc.data[field];
  return isTimestampLike(t) ? t : null;
}

async function pullCollection(ctx: SyncContext, tbl: CollectionName, report: PullReport): Promise<void> {
  const field = tbl === 'reviewLogs' ? 'created' : 'updated';
  const cursor = await ctx.local.getCursor(tbl);
  const since = cursor ? new CloudTime(cursor.seconds, cursor.nanos).plusMillis(-limitsOf(ctx).overlapMs) : null;
  let after: { time: TimestampLike; id: string } | null = null;
  let best = cursor ? { time: new CloudTime(cursor.seconds, cursor.nanos) as TimestampLike, id: cursor.docId } : null;
  for (let page = 0; page < limitsOf(ctx).maxPages; page++) {
    const docs = await ctx.remote.query({ collection: tbl, uid: ctx.uid, field, since, after, limit: limitsOf(ctx).pageSize });
    for (const d of docs) {
      const o = await applyIncoming(ctx, tbl, d);
      if (o === 'applied') {
        report.applied += 1;
        if (tbl === 'notes') report.changedNotes.push(d.id);
      } else if (o === 'conflict') report.conflicts += 1;
      else if (o === 'quarantined') report.quarantined += 1;
      else report.skipped += 1;
    }
    const last = docs[docs.length - 1];
    const lastTime = last ? timeOf(last, field) : null;
    if (last && lastTime) {
      after = { time: lastTime, id: last.id };
      const c = compareTime(lastTime, best?.time ?? new CloudTime(0, 0));
      if (!best || c > 0 || (c === 0 && last.id > best.id)) {
        best = after;
        await ctx.local.setCursor(tbl, { seconds: lastTime.seconds, nanos: lastTime.nanoseconds, docId: last.id });
      }
    }
    if (docs.length < limitsOf(ctx).pageSize) break;
  }
}

/** Pulls the profile, then every collection. */
export async function pull(ctx: SyncContext): Promise<PullReport> {
  const report: PullReport = { applied: 0, skipped: 0, conflicts: 0, quarantined: 0, changedNotes: [] };
  const profile = await ctx.remote.get('users', ctx.uid);
  if (profile && profile.data.deletionRequestedAt != null) throw new AccountGoneError();
  if (profile) {
    await applyIncoming(ctx, 'users', profile);
  } else {
    const localUser = await ctx.local.readRow('users', 'local');
    if (Number(localUser?.rev ?? 0) > 0) throw new AccountGoneError();
  }
  for (const tbl of COLLECTION_NAMES) await pullCollection(ctx, tbl, report);
  return report;
}
