/**
 * Assets repository (P4b): rows of the `assets` table, which mirrors P2a's
 * assets/{id} cloud doc (type, cloudPath, size) plus the local-only
 * `localPath`.
 *
 * P4b uses it for ink layers (type 'ink'); P4 will reuse it for audio.
 * Rules:
 *  - localPath is RELATIVE to the app's document directory (for example
 *    "ink/a_123….json"). iOS can move the app container on updates, so an
 *    absolute path would break. It is validated against a strict pattern
 *    (no "..", no leading "/"), and it is never synced (P2a §D.2).
 *  - size is the exact byte size of the local file. P2a's Storage rule
 *    requires the uploaded file to have exactly this size, so callers set it
 *    only after the file is fully written (ink: at publish time).
 *  - cloudPath and owner are filled by P2b's sync, never here.
 *  - Deleting marks a tombstone (deleted = 1) and clears localPath; P2b then
 *    deletes the Storage file and erases cloudPath/size in the cloud.
 * Every statement uses ? placeholders.
 */
import { AppError, ENTITY_ID_PATTERN, type IdGenerator } from '@/core';

import { int01, metaFromRow, num, str, strOrNull } from './rows';
import type { SqlExecutor, SqlRow } from './sql';
import type { SyncedMeta } from './types';

export const ASSET_TYPES = ['audio', 'image', 'sticker', 'ink', 'pdf'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** Byte caps per type, the same as P2a STORAGE (firebase/src/schemas/limits.ts). */
export const ASSET_MAX_BYTES: Record<AssetType, number> = {
  audio: 64 * 1024 * 1024,
  image: 5 * 1024 * 1024,
  sticker: 5 * 1024 * 1024,
  ink: 5 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
};

/** Relative path: folder segments, then name.ext; only [A-Za-z0-9_-] in names. */
export const LOCAL_PATH = /^[a-z]{1,20}(\/[A-Za-z0-9_-]{1,64})*\/[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,5}$/;

export interface Asset extends SyncedMeta {
  type: AssetType;
  cloudPath: string | null;
  size: number;
  /** Local only: relative to the document directory, or null when not on this device. */
  localPath: string | null;
}

export interface AssetsDeps {
  ids: IdGenerator;
  now: () => number;
}

function assetOf(r: SqlRow): Asset {
  const type = str(r.type);
  return {
    ...metaFromRow(r),
    type: (ASSET_TYPES as readonly string[]).includes(type) ? (type as AssetType) : 'image',
    cloudPath: strOrNull(r.cloudPath),
    size: num(r.size),
    localPath: strOrNull(r.localPath),
  };
}

function checkSize(type: AssetType, size: number): void {
  if (!Number.isInteger(size) || size < 0 || size > ASSET_MAX_BYTES[type]) {
    throw new AppError('too_large', 'This file is too large to save.');
  }
}

function checkPath(p: string | null): void {
  if (p !== null && (!LOCAL_PATH.test(p) || p.includes('..'))) throw new AppError('validation_failed', 'Invalid file location.');
}

const COLS = 'id, owner, created, updated, rev, deleted, type, cloudPath, size, localPath';

export function createAssetsRepo(deps: AssetsDeps) {
  const get = async (ex: SqlExecutor, id: string): Promise<Asset | null> => {
    const r = await ex.get(`SELECT ${COLS} FROM assets WHERE id = ?`, [id]);
    return r ? assetOf(r) : null;
  };

  return {
    get,

    /** Live (not deleted) assets of one type. */
    async listByType(ex: SqlExecutor, type: AssetType): Promise<Asset[]> {
      const rows = await ex.all(`SELECT ${COLS} FROM assets WHERE type = ? AND deleted = 0 ORDER BY created`, [type]);
      return rows.map(assetOf);
    },

    /** A new local asset (owner copied from its note so a signed-in user's rows stay consistent). */
    async create(tx: SqlExecutor, input: { type: AssetType; localPath: string; size: number; owner: string | null; id?: string }): Promise<Asset> {
      checkSize(input.type, input.size);
      checkPath(input.localPath);
      const id = input.id ?? deps.ids.newId('a');
      if (!ENTITY_ID_PATTERN.test(id)) throw new AppError('validation_failed', 'Invalid file id.');
      const t = deps.now();
      await tx.run(
        `INSERT INTO assets (id, owner, schemaVersion, created, updated, rev, deleted, type, cloudPath, size, localPath)
         VALUES (?, ?, 1, ?, ?, 0, 0, ?, NULL, ?, ?)`,
        [id, input.owner, t, t, input.type, input.size, input.localPath],
      );
      return { id, owner: input.owner, created: t, updated: t, rev: 0, deleted: false, type: input.type, cloudPath: null, size: input.size, localPath: input.localPath };
    },

    /** Records a new size (after the file was rewritten) and/or local path. */
    async update(tx: SqlExecutor, id: string, patch: { size?: number; localPath?: string | null }): Promise<Asset> {
      const cur = await get(tx, id);
      if (!cur || cur.deleted) throw new AppError('not_found', 'That file no longer exists.');
      const size = patch.size ?? cur.size;
      const localPath = patch.localPath !== undefined ? patch.localPath : cur.localPath;
      checkSize(cur.type, size);
      checkPath(localPath);
      const updated = Math.max(deps.now(), cur.updated);
      await tx.run('UPDATE assets SET size = ?, localPath = ?, updated = ? WHERE id = ?', [size, localPath, updated, id]);
      return { ...cur, size, localPath, updated };
    },

    /**
     * Records where a DOWNLOADED file now lives on this device. localPath is
     * local only, so `updated` is NOT bumped: this must not look like a
     * synced change (P2b would upload the asset again).
     */
    async setLocalPath(tx: SqlExecutor, id: string, localPath: string | null): Promise<void> {
      checkPath(localPath);
      await tx.run('UPDATE assets SET localPath = ? WHERE id = ? AND deleted = 0', [localPath, id]);
    },

    /** Tombstone: P2b deletes the cloud file and erases the cloud fields. */
    async markDeleted(tx: SqlExecutor, id: string): Promise<void> {
      await tx.run('UPDATE assets SET deleted = ?, localPath = NULL, updated = ? WHERE id = ? AND deleted = 0', [int01(true), deps.now(), id]);
    },

    /**
     * Ink assets no note points at any more. Notes deleted within the undo
     * window still hold their inkLayerRef (P1's purge clears it after the
     * window), so an undo never finds its drawing gone.
     */
    async inkOrphans(ex: SqlExecutor): Promise<Asset[]> {
      const rows = await ex.all(
        `SELECT ${COLS.split(', ').map((c) => `a.${c}`).join(', ')} FROM assets a
         WHERE a.type = 'ink' AND a.deleted = 0
           AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.inkLayerRef = a.id)`,
      );
      return rows.map(assetOf);
    },
  };
}

export type AssetsRepo = ReturnType<typeof createAssetsRepo>;
