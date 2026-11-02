/**
 * Files behind asset docs (audio, images, stickers, ink, pdf): the asset
 * pass (decision Q12; docs/modules/sync.md "Assets").
 *
 * P2a contract (§D.5): write the asset doc first (exact `size`, exact
 * `cloudPath`), THEN upload the file; Storage rules re-check both. So a
 * changed file is never uploaded by the normal push: the asset pass pushes
 * its doc itself and then uploads the bytes.
 *
 * For each asset this device holds a file for (localPath set):
 *   localChanged  = the file's hash differs from the last synced version
 *   remoteChanged = the asset doc's rev is newer than the last synced
 *                   version (another device uploaded a new file)
 *   - remote only -> download and replace the local file
 *   - local       -> push the doc (size, cloudPath), then upload
 *   - both        -> with a merger registered for the asset type (P4b's
 *                    ink), download, merger(local, remote) -> merged bytes,
 *                    write them locally and upload them on top of the
 *                    server version. Without one: last push wins (ours).
 *   A stale doc write found during the upload is handled the same way
 *   (resolveStale makes the local rev the server rev, so the next round
 *   sees "both changed").
 * Files of assets pulled from other devices are fetched on demand
 * (ensureLocalFile), never in bulk: the free tier allows 50K downloads a
 * month and phones have little space.
 * Deleted assets: the Storage file is removed, then the tombstone syncs
 * with cloudPath null and size 0 (normal push).
 */
import { AppError } from '@/core';
import type { AssetFileRow, OutboxItem } from '@/modules/store';

import { ASSET_FOLDER, STORAGE, type AssetType } from './cloudSchemas';
import type { SyncContext } from './context';
import { RemoteError } from './ports';
import { push } from './push';

/** Combines two versions of a file into one (must be deterministic and pure). */
export type AssetMerger = (localBytes: Uint8Array, remoteBytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** The device's files (expo-file-system on phones, memory in tests). */
export interface FileStorePort {
  read(localPath: string): Promise<Uint8Array | null>;
  write(localPath: string, bytes: Uint8Array): Promise<void>;
  remove(localPath: string): Promise<void>;
  /** Where to keep a downloaded file for this asset (an app-private path). */
  pathFor(asset: { id: string; type: AssetType; ext: string }): string;
}

/** Cloud Storage (firebase/storage in the app; the fake cloud in tests). */
export interface BlobStorePort {
  upload(cloudPath: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** null when the file does not exist (or is not readable). */
  download(cloudPath: string): Promise<Uint8Array | null>;
  remove(cloudPath: string): Promise<void>;
}

export interface AssetSyncDeps {
  files: FileStorePort;
  blobs: BlobStorePort;
  mergers?: AssetMergerRegistry;
}

export interface AssetMergerRegistry {
  register(type: AssetType, merger: AssetMerger): () => void;
  get(type: string): AssetMerger | undefined;
}

export function createAssetMergerRegistry(): AssetMergerRegistry {
  const map = new Map<string, AssetMerger>();
  return {
    register(type, merger) {
      map.set(type, merger);
      return () => {
        if (map.get(type) === merger) map.delete(type);
      };
    },
    get: (type) => map.get(type),
  };
}

/** The app-wide registry. P4b calls registerAssetMerger('ink', mergeInk) at start-up. */
const defaultMergers = createAssetMergerRegistry();
export const registerAssetMerger = (type: AssetType, merger: AssetMerger): (() => void) => defaultMergers.register(type, merger);
export const defaultAssetMergers = (): AssetMergerRegistry => defaultMergers;

export interface AssetReport {
  uploaded: number;
  downloaded: number;
  merged: number;
  removed: number;
  failed: number;
}

const CONTENT_TYPE: Record<string, string> = {
  m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  json: 'application/json', pdf: 'application/pdf',
};

const isAssetType = (t: string): t is AssetType => Object.prototype.hasOwnProperty.call(ASSET_FOLDER, t);

/** File extension from a path, if allowed for this asset type. */
export function extFor(type: string, path: string | null): string | null {
  if (!isAssetType(type) || !path) return null;
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(path);
  const ext = m?.[1]?.toLowerCase();
  const allowed: readonly string[] = STORAGE[ASSET_FOLDER[type]].exts;
  return ext && allowed.includes(ext) ? ext : null;
}

/** users/{uid}/{folder}/{id}.{ext}, exactly as the rules require. */
export function cloudPathFor(uid: string, type: AssetType, id: string, ext: string): string {
  return `users/${uid}/${ASSET_FOLDER[type]}/${id}.${ext}`;
}

/** cyrb53 over bytes: change detection only (not security). */
export function hashBytes(b: Uint8Array): string {
  let h1 = 0xdeadbeef ^ b.length;
  let h2 = 0x41c6ce57 ^ b.length;
  for (let i = 0; i < b.length; i++) {
    const ch = b[i] as number;
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${b.length.toString(36)}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

const MAX_ATTEMPTS = 3;

/** Uploads the doc for `id` alone (the asset pass owns changed-file docs). true = this upload was accepted. */
async function pushAssetDoc(ctx: SyncContext, id: string): Promise<boolean> {
  const r = await push(ctx, { filter: (i: OutboxItem) => i.tbl === 'assets' && i.id === id });
  return r.uploaded + r.acked > 0 && (await ctx.local.getOutbox('assets', id)) === null;
}

async function current(ctx: SyncContext, id: string): Promise<AssetFileRow | undefined> {
  return (await ctx.local.listAssetFiles()).find((a) => a.id === id);
}

async function syncOne(ctx: SyncContext, deps: AssetSyncDeps, a: AssetFileRow, report: AssetReport): Promise<void> {
  const { local, uid } = ctx;
  if (a.deleted) {
    if (a.file) {
      await deps.blobs.remove(a.file.syncedPath);
      await local.removeFileRecord(a.id);
      report.removed += 1;
    }
    return;
  }
  if (!a.localPath || !isAssetType(a.type)) return;
  const ext = extFor(a.type, a.localPath);
  if (!ext) {
    await local.quarantine({ tbl: 'assets', id: a.id, direction: 'out', reason: 'file_type' });
    return;
  }
  const cloudPath = cloudPathFor(uid, a.type, a.id, ext);
  const maxBytes = STORAGE[ASSET_FOLDER[a.type]].maxBytes;

  let row = a;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let bytes = await deps.files.read(row.localPath ?? '');
    if (!bytes) return; // file gone from the phone: nothing to send
    const hash = hashBytes(bytes);
    const localChanged = !row.file || row.file.syncedHash !== hash;
    const remoteChanged = !!row.file && row.rev > row.file.syncedRev && row.cloudPath !== null;

    if (!localChanged && !remoteChanged) return;

    if (remoteChanged && row.cloudPath) {
      const merger = deps.mergers?.get(row.type);
      if (!localChanged) {
        const remote = await deps.blobs.download(row.cloudPath);
        // The doc goes up before the file, so a size mismatch means the other
        // device's upload hasn't finished yet: try again next sync.
        if (!remote || remote.length !== row.size) return;
        await deps.files.write(row.localPath ?? '', remote);
        await local.putFileRecord({ id: row.id, syncedHash: hashBytes(remote), syncedRev: row.rev, syncedPath: row.cloudPath });
        report.downloaded += 1;
        return;
      }
      if (merger) {
        // Merge with whatever version is in Storage. If it is older than the
        // doc (an upload still in flight), that device's own next sync merges
        // its change on top of ours, so nothing is lost.
        const remote = await deps.blobs.download(row.cloudPath);
        if (remote) {
          bytes = await merger(bytes, remote);
          await deps.files.write(row.localPath ?? '', bytes);
          report.merged += 1;
        }
      }
      // No merger and both changed: ours goes on top (last push wins).
    }

    if (bytes.length === 0 || bytes.length > maxBytes) {
      await local.quarantine({ tbl: 'assets', id: row.id, direction: 'out', reason: 'file_size' });
      return;
    }
    // 1. The doc first, with the exact size and path.
    await local.setAssetFile(row.id, cloudPath, bytes.length);
    if (!(await pushAssetDoc(ctx, row.id))) {
      // Stale: resolveStale took the server's doc; next round sees "both changed".
      const next = await current(ctx, row.id);
      if (!next || (await ctx.local.getOutbox('assets', row.id))?.state === 'quarantined') return;
      row = next;
      continue;
    }
    const pushed = await current(ctx, row.id);
    if (!pushed) return;
    // 2. Then the bytes.
    await deps.blobs.upload(cloudPath, bytes, CONTENT_TYPE[ext] ?? 'application/octet-stream');
    await local.putFileRecord({ id: row.id, syncedHash: hashBytes(bytes), syncedRev: pushed.rev, syncedPath: cloudPath });
    report.uploaded += 1;
    return;
  }
}

/** Runs the asset pass for every asset with a local file. */
export async function syncAssetFiles(ctx: SyncContext, deps: AssetSyncDeps): Promise<AssetReport> {
  const report: AssetReport = { uploaded: 0, downloaded: 0, merged: 0, removed: 0, failed: 0 };
  for (const a of await ctx.local.listAssetFiles()) {
    try {
      await syncOne(ctx, deps, a, report);
    } catch (e) {
      if (e instanceof RemoteError && e.code !== 'permission-denied') throw e; // offline etc.: the whole pass stops
      report.failed += 1;
      ctx.logger.warn('sync.asset_failed', { code: e instanceof RemoteError ? e.code : 'unknown' });
    }
  }
  return report;
}

/** Is this asset's file changed locally (its doc must wait for the asset pass)? */
export async function hasUnsyncedFile(deps: AssetSyncDeps, a: AssetFileRow | undefined): Promise<boolean> {
  if (!a || a.deleted || !a.localPath) return false;
  const bytes = await deps.files.read(a.localPath);
  return !!bytes && (!a.file || a.file.syncedHash !== hashBytes(bytes));
}

/**
 * Returns a local path for the asset's file, downloading it on demand
 * (e.g. an ink layer or a recording made on another device).
 */
export async function ensureLocalFile(ctx: SyncContext, deps: AssetSyncDeps, id: string): Promise<string> {
  const row = await ctx.local.readRow('assets', id);
  if (!row || row.deleted === 1) throw new AppError('not_found', 'This file is no longer available.');
  const type = String(row.type);
  if (typeof row.localPath === 'string' && (await deps.files.read(row.localPath))) return row.localPath;
  const cloudPath = typeof row.cloudPath === 'string' ? row.cloudPath : null;
  const ext = extFor(type, cloudPath);
  if (!cloudPath || !ext || !isAssetType(type)) throw new AppError('not_found', 'This file has not been uploaded yet.');
  if (cloudPath !== cloudPathFor(ctx.uid, type, id, ext)) throw new AppError('validation_failed', 'This file is not valid.');
  const bytes = await deps.blobs.download(cloudPath);
  if (!bytes) throw new AppError('network', 'This file could not be downloaded. Try again when you are online.');
  const localPath = deps.files.pathFor({ id, type, ext });
  await deps.files.write(localPath, bytes);
  await ctx.local.run(async (s) => {
    await s.setLocalPath(id, localPath);
    await s.putFileRecord({ id, syncedHash: hashBytes(bytes), syncedRev: Number(row.rev), syncedPath: cloudPath });
  });
  return localPath;
}
