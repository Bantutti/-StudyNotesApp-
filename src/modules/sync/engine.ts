/**
 * The sync engine: one sync at a time (single flight), push then pull, and
 * a small status model for the sync chip and the Me screen.
 *
 * It runs only when the store says sync is on AND the database is bound to
 * the signed-in uid (Q7), so a different account can never receive this
 * phone's notes. Scheduling (debounce, foreground, timers, network) lives in
 * scheduler.ts; screens call syncNow() for "Sync now" and pull-to-refresh.
 */
import { AppError } from '@/core';
import type { OutboxItem, SyncTable } from '@/modules/store';

import { ensureLocalFile, hasUnsyncedFile, syncAssetFiles, type AssetReport, type AssetSyncDeps } from './assets';

import { resolveConflict, type ConflictChoice } from './conflicts';
import { AccountGoneError, type SyncContext } from './context';
import { collectionOf } from './mapping';
import { RemoteError, TRANSIENT_CODES } from './ports';
import { applyIncoming, pull, type PullReport } from './pull';
import { push, type PushReport } from './push';

export type SyncPhase = 'disabled' | 'idle' | 'syncing' | 'offline' | 'error' | 'account_gone';

export interface SyncStatus {
  phase: SyncPhase;
  /** Queued uploads (all tables). */
  pending: number;
  /** Conflicts waiting in Needs attention. */
  conflicts: number;
  /** Docs that failed validation (either direction). */
  quarantined: number;
  lastSyncedAt: number | null;
  /** Content-free error code for the last failed run. */
  errorCode: string | null;
}

export interface SyncRunResult {
  push: PushReport | null;
  pull: PullReport | null;
  assets: AssetReport | null;
  status: SyncStatus;
}

export interface SyncProgress {
  step: 'upload' | 'download' | 'files' | 'done';
  /** Uploads accepted so far / queued when the run started (upload step). */
  done: number;
  total: number;
}

export interface SyncEngine {
  /** One sync (push, pull, files). Concurrent calls share the running one. */
  syncNow(opts?: { onProgress?: (p: SyncProgress) => void }): Promise<SyncRunResult>;
  /** Re-reads one note from the server (when a note is opened; cuts conflicts). */
  refreshOne(tbl: SyncTable, id: string): Promise<void>;
  resolve(tbl: SyncTable, id: string, choice: ConflictChoice): Promise<{ copyId: string | null }>;
  /** A local path for an asset's file, downloaded on demand. */
  ensureLocalFile(id: string): Promise<string>;
  status(): Promise<SyncStatus>;
  subscribe(fn: (s: SyncStatus) => void): () => void;
  /** Called with the ids of notes a pull changed (an open editor reloads them). */
  onNotesChanged(fn: (ids: string[]) => void): () => void;
}

function errorCodeOf(e: unknown): string {
  if (e instanceof RemoteError) return e.code;
  if (e instanceof AppError) return e.code;
  return 'unknown';
}

export interface SyncEngineOptions {
  /** File sync (asset pass). Without it, asset docs sync but files don't. */
  assets?: AssetSyncDeps;
}

export function createSyncEngine(ctx: SyncContext, opts: SyncEngineOptions = {}): SyncEngine {
  const assets = opts.assets;
  /** Normal pushes leave changed-file asset docs to the asset pass (doc then file, in order). */
  const pushOpts = assets
    ? {
        filter: async (i: OutboxItem) => {
          if (i.tbl !== 'assets') return true;
          const a = (await ctx.local.listAssetFiles()).find((x) => x.id === i.id);
          return !(await hasUnsyncedFile(assets, a));
        },
      }
    : {};
  const subs = new Set<(s: SyncStatus) => void>();
  const noteSubs = new Set<(ids: string[]) => void>();
  let running: Promise<SyncRunResult> | null = null;
  let again = false;
  let phase: SyncPhase = 'idle';
  let errorCode: string | null = null;

  const status = async (): Promise<SyncStatus> => {
    const st = await ctx.local.getState();
    const counts = await ctx.local.countOutbox('pending');
    const pending = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
    const quarantined = (await ctx.local.listQuarantine()).length;
    const enabled = st.enabled && st.uid === ctx.uid;
    return {
      phase: enabled ? phase : phase === 'account_gone' ? phase : 'disabled',
      pending,
      conflicts: await ctx.local.countConflicts(),
      quarantined,
      lastSyncedAt: st.lastPullAt,
      errorCode,
    };
  };

  const emit = async () => {
    const s = await status();
    subs.forEach((f) => f(s));
    return s;
  };

  let progress: ((p: SyncProgress) => void) | undefined;

  const runOnce = async (): Promise<SyncRunResult> => {
    const st = await ctx.local.getState();
    if (!st.enabled || st.uid !== ctx.uid) return { push: null, pull: null, assets: null, status: await emit() };
    phase = 'syncing';
    await emit();
    let pushReport: PushReport | null = null;
    let pullReport: PullReport | null = null;
    let assetReport: AssetReport | null = null;
    const total = Object.values(await ctx.local.countOutbox('pending')).reduce((a, b) => a + (b ?? 0), 0);
    const report = (step: SyncProgress['step'], done: number) => progress?.({ step, done, total });
    try {
      report('upload', 0);
      pushReport = await push(ctx, { ...pushOpts, onUploaded: (n) => report('upload', n) });
      report('download', pushReport.uploaded);
      await ctx.local.recordRun('push', null);
      pullReport = await pull(ctx);
      await ctx.local.recordRun('pull', null);
      report('files', pushReport.uploaded);
      if (assets) assetReport = await syncAssetFiles(ctx, assets);
      // A pull can turn a conflict into "local wins": send that right away.
      if ((await ctx.local.listOutbox({ limit: 1 })).length > 0) pushReport = await push(ctx, pushOpts);
      phase = 'idle';
      errorCode = null;
      report('done', total);
      if (pullReport.changedNotes.length) noteSubs.forEach((f) => f(pullReport?.changedNotes ?? []));
    } catch (e) {
      errorCode = errorCodeOf(e);
      if (e instanceof AccountGoneError) {
        phase = 'account_gone';
        errorCode = 'account_gone';
        await ctx.local.setEnabled(false);
      } else if (e instanceof RemoteError && TRANSIENT_CODES.includes(e.code)) {
        phase = 'offline';
      } else {
        phase = 'error';
        ctx.logger.warn('sync.failed', { code: errorCode });
      }
      await ctx.local.recordRun(pushReport ? 'pull' : 'push', errorCode);
    }
    return { push: pushReport, pull: pullReport, assets: assetReport, status: await emit() };
  };

  return {
    syncNow(opts = {}) {
      if (opts.onProgress) progress = opts.onProgress;
      if (running) {
        again = true;
        return running;
      }
      const loop = async (): Promise<SyncRunResult> => {
        let r = await runOnce();
        while (again) {
          again = false;
          r = await runOnce();
        }
        return r;
      };
      running = loop().finally(() => {
        running = null;
        progress = undefined;
      });
      return running;
    },

    async refreshOne(tbl, id) {
      const st = await ctx.local.getState();
      if (!st.enabled || st.uid !== ctx.uid) return;
      try {
        const doc = await ctx.remote.get(collectionOf(tbl), id);
        if (doc) {
          const o = await applyIncoming(ctx, tbl, doc);
          if (o === 'applied' && tbl === 'notes') noteSubs.forEach((f) => f([id]));
        }
      } catch (e) {
        if (!(e instanceof RemoteError)) throw e; // offline: the local copy is fine
      }
      await emit();
    },

    async resolve(tbl, id, choice) {
      const r = await resolveConflict({ local: ctx.local, ids: ctx.ids }, tbl, id, choice);
      await emit();
      if (tbl === 'notes') noteSubs.forEach((f) => f(r.copyId ? [id, r.copyId] : [id]));
      return r;
    },

    async ensureLocalFile(id) {
      if (!assets) throw new AppError('unsupported', 'File sync is not available.');
      return ensureLocalFile(ctx, assets, id);
    },

    status,

    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },

    onNotesChanged(fn) {
      noteSubs.add(fn);
      return () => {
        noteSubs.delete(fn);
      };
    },
  };
}
