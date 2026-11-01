/**
 * Upload: outbox -> cloud (docs/modules/sync.md "Push").
 *
 * 1. Profile first: users/{uid} must exist and not be mid-deletion before
 *    anything else is written (P2a §D.3, §D.6). 1 read per push.
 * 2. Each queued row is prepared: tombstones wait out the 8-second undo
 *    window and are erased; notes get ensureBlockIds (saved locally first);
 *    the exact resulting document is checked with P2a's zod schema.
 * 3. Writes go in batches. A batch is all-or-nothing, so a rejected batch
 *    is split in halves until the single rejected write is found, which is
 *    then classified by reading the server copy (classify()).
 * 4. On success the local rev/owner are updated; the outbox item is
 *    cleared only if the row was not edited during the upload.
 */
import { ensureBlockIds, parseNoteDocJson } from '@/core';
import { UNDO_WINDOW_MS, type OutboxItem, type SqlRow } from '@/modules/store';

import { AccountGoneError, contentHash, limitsOf, type SyncContext } from './context';
import { collectionOf, docIdOf, eraseRow, planWrite, type PlannedWrite } from './mapping';
import { RemoteError, TRANSIENT_CODES, type RemoteDoc } from './ports';
import { resolveStale } from './resolve';
import { eraseLocalTombstone } from './tombstone';
import { CloudTime } from './time';
import { checkIncoming, checkOutgoing } from './validate';

export interface PushReport {
  uploaded: number;
  conflicts: number;
  quarantined: number;
  /** Tombstones still inside the undo window. */
  deferred: number;
  /** Refused writes that turned out to have landed already (lost acks). */
  acked: number;
  /** Stale writes resolved by taking the server's copy. */
  replaced: number;
}

interface Prepared {
  item: OutboxItem;
  row: SqlRow;
  plan: PlannedWrite;
  hash: string;
}

const isTransient = (e: unknown) => e instanceof RemoteError && TRANSIENT_CODES.includes(e.code);

/** Reads users/{uid}; throws AccountGoneError when the account is being (or was) deleted. */
async function ensureProfile(ctx: SyncContext): Promise<void> {
  const profile = await ctx.remote.get('users', ctx.uid);
  if (profile && profile.data.deletionRequestedAt != null) throw new AccountGoneError();
  const localUser = await ctx.local.readRow('users', 'local');
  if (!profile) {
    // Writes require the profile, so "no profile" after we once had one means it was deleted.
    if (Number(localUser?.rev ?? 0) > 0) throw new AccountGoneError();
    if (!(await ctx.local.getOutbox('users', 'local'))) await ctx.local.requeue('users', 'local');
    return;
  }
  if (Number(localUser?.rev ?? 0) === 0) {
    // First sync on this device and the account already has a profile: the cloud's settings win.
    const chk = checkIncoming('users', profile, ctx.uid);
    if (!chk.ok) {
      await ctx.local.quarantine({ tbl: 'users', id: ctx.uid, direction: 'in', reason: chk.reason });
      return;
    }
    await ctx.local.run(async (s) => {
      await s.applyRemote('users', chk.value);
      await s.removeOutbox('users', 'local');
    });
  }
}

/** Prepares one outbox item, or handles it locally (returns a string outcome). */
async function prepare(ctx: SyncContext, item: OutboxItem): Promise<Prepared | 'done' | 'deferred' | 'quarantined'> {
  const { local } = ctx;
  let row = await local.readRow(item.tbl, item.id);
  if (!row) {
    await local.removeOutbox(item.tbl, item.id); // removed from this phone only; nothing to upload
    return 'done';
  }
  const tbl = item.tbl;
  if (tbl !== 'users' && tbl !== 'reviewLogs' && row.deleted === 1) {
    if (Number(row.rev) === 0) {
      await local.removeOutbox(tbl, item.id); // created and deleted before it was ever uploaded
      return 'done';
    }
    if (ctx.now() - Number(row.updated) < UNDO_WINDOW_MS) return 'deferred';
    row = eraseRow(tbl, row);
  } else if (tbl === 'notes') {
    const json = String(row.document);
    const parsed = parseNoteDocJson(json);
    if (!parsed.ok) {
      await local.quarantine({ tbl, id: item.id, direction: 'out', reason: 'document' });
      return 'quarantined';
    }
    const fixed = JSON.stringify(ensureBlockIds(parsed.value, ctx.ids));
    if (fixed !== json) {
      // Save the new ids locally FIRST, so every device gets the same ids.
      if (!(await local.replaceNoteDocument(item.id, json, fixed))) return 'deferred'; // edited meanwhile: next round
      row = { ...row, document: fixed };
    }
  }
  const plan = planWrite(tbl, row, ctx.uid, CloudTime.fromMillis(ctx.now()));
  const chk = checkOutgoing(tbl, plan.expected);
  if (!chk.ok) {
    await local.quarantine({ tbl, id: item.id, direction: 'out', reason: chk.reason });
    ctx.logger.warn('sync.push_invalid', { tbl, reason: chk.reason });
    return 'quarantined';
  }
  return { item, row, plan, hash: contentHash(plan.expected) };
}

/** A single write was refused: find out why from the server copy. */
async function classify(ctx: SyncContext, p: Prepared, report: PushReport): Promise<void> {
  const { local, remote, uid } = ctx;
  const tbl = p.item.tbl;
  const docId = docIdOf(tbl, p.row, uid);
  const profile = await remote.get('users', uid);
  if (!profile || profile.data.deletionRequestedAt != null) {
    if (tbl !== 'users' || p.plan.write.op !== 'set') throw new AccountGoneError();
  }
  const server: RemoteDoc | null = tbl === 'users' ? profile : await remote.get(collectionOf(tbl), docId);

  if (!server) {
    if (p.plan.write.op === 'set') {
      await local.quarantine({ tbl, id: p.item.id, direction: 'out', reason: 'rejected' });
      report.quarantined += 1;
    } else if (p.row.deleted === 1) {
      await local.removeOutbox(tbl, p.item.id); // already gone from the cloud
    } else {
      // The cloud copy vanished: upload it again as new.
      await local.run(async (s) => {
        await s.setLocalRev(tbl, p.item.id, 0);
        await s.requeue(tbl, p.item.id);
      });
    }
    return;
  }

  const serverHash = contentHash(server.data);
  const serverRev = Number(server.data.rev ?? 1);

  // Review logs are create-only: "already there" means done (union merge).
  if (tbl === 'reviewLogs') {
    await local.markPushed(tbl, p.item.id, { sentSeq: p.item.seq, rev: 1, owner: uid });
    return;
  }
  // Lost acknowledgement: an earlier attempt (or this one) actually landed.
  // Not for assets: their doc (size, path) can't tell two different files of
  // the same size apart, so the stale path below handles them (always safe).
  const identifiable = tbl !== 'assets';
  const earlier = identifiable && p.item.sentRev === serverRev && p.item.sentHash === serverHash;
  const now = identifiable && p.plan.sentRev === serverRev && p.hash === serverHash;
  if (earlier || now) {
    await local.run(async (s) => {
      await s.markPushed(tbl, p.item.id, { sentSeq: earlier ? (p.item.sentSeq ?? 0) : p.item.seq, rev: serverRev, owner: uid });
      await eraseLocalTombstone(s, tbl, p.item.id);
    });
    report.acked += 1;
    return;
  }

  if (serverRev > Number(p.row.rev)) {
    const chk = checkIncoming(tbl, server, uid);
    if (!chk.ok) {
      // The server copy is invalid: overwrite it with ours (rev + 1 on top of it).
      await local.quarantine({ tbl, id: p.item.id, direction: 'in', reason: chk.reason });
      await local.setLocalRev(tbl, p.item.id, serverRev);
      return;
    }
    const outcome = await local.run(async (s) => {
      const cur = await s.getOutbox(tbl, p.item.id);
      const localRow = await s.readRow(tbl, p.item.id);
      if (!cur || !localRow) return 'gone';
      return resolveStale(s, tbl, localRow, chk.value);
    });
    if (outcome === 'conflict') report.conflicts += 1;
    if (outcome === 'took_server') report.replaced += 1;
    return;
  }

  // Same or older rev on the server, yet refused: our payload is the problem.
  await local.quarantine({ tbl, id: p.item.id, direction: 'out', reason: 'rejected' });
  report.quarantined += 1;
  ctx.logger.warn('sync.push_rejected', { tbl });
}

async function commit(ctx: SyncContext, batch: Prepared[], report: PushReport): Promise<void> {
  if (batch.length === 0) return;
  await ctx.local.run(async (s) => {
    for (const p of batch) await s.markSent(p.item.tbl, p.item.id, { seq: p.item.seq, rev: p.plan.sentRev, hash: p.hash });
  });
  try {
    await ctx.remote.commit(batch.map((p) => p.plan.write));
  } catch (e) {
    if (isTransient(e)) throw e;
    if (e instanceof RemoteError && e.code === 'unauthenticated') throw e;
    if (batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      await commit(ctx, batch.slice(0, mid), report);
      await commit(ctx, batch.slice(mid), report);
      return;
    }
    await classify(ctx, batch[0] as Prepared, report);
    return;
  }
  await ctx.local.run(async (s) => {
    for (const p of batch) {
      await s.markPushed(p.item.tbl, p.item.id, { sentSeq: p.item.seq, rev: p.plan.sentRev, owner: ctx.uid });
      await eraseLocalTombstone(s, p.item.tbl, p.item.id);
    }
  });
  report.uploaded += batch.length;
}

export interface PushOptions {
  /** Only upload items this returns true for (the asset pass uses it). */
  filter?: (item: OutboxItem) => boolean | Promise<boolean>;
}

export async function push(ctx: SyncContext, opts: PushOptions = {}): Promise<PushReport> {
  const report: PushReport = { uploaded: 0, conflicts: 0, quarantined: 0, deferred: 0, acked: 0, replaced: 0 };
  await ensureProfile(ctx);
  for (let round = 0; round < limitsOf(ctx).maxRounds; round++) {
    const items = await ctx.local.listOutbox({ limit: limitsOf(ctx).batchSize });
    if (items.length === 0) break;
    const ready: Prepared[] = [];
    let handled = 0;
    report.deferred = 0;
    for (const item of items) {
      if (opts.filter && !(await opts.filter(item))) continue;
      const p = await prepare(ctx, item);
      if (p === 'deferred') report.deferred += 1;
      else if (p === 'quarantined') {
        report.quarantined += 1;
        handled += 1;
      } else if (p === 'done') handled += 1;
      else ready.push(p);
    }
    if (ready.length === 0 && handled === 0) break; // only deferred items left
    // The profile goes alone, first: the rules check it exists for every other write.
    const users = ready.filter((p) => p.item.tbl === 'users');
    const rest = ready.filter((p) => p.item.tbl !== 'users');
    await commit(ctx, users, report);
    if (users.length > 0 && (await ctx.local.getOutbox('users', 'local'))?.state === 'quarantined') break;
    await commit(ctx, rest, report);
  }
  return report;
}

