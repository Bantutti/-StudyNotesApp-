/**
 * Custom style packs repository (P5 "Match a look", decision Q7 = A).
 *
 * Table `stylePacks` (migration 1) mirrors P2a's cloud doc field for field:
 * id, owner, schemaVersion, created, updated, rev, deleted, version,
 * definition (capped JSON string), createdFromReference. P2b's change
 * triggers already cover this table, so saved packs sync with no extra code.
 *
 * The store does NOT judge pack contents: it stores a JSON object up to the
 * cloud cap. The composition layer validates every definition with
 * stylepacks' validatePack before it reaches the registry (validate on
 * load, P2a MERGE_NOTES), so tampered rows are dropped there.
 */
import { AppError, ENTITY_ID_PATTERN } from '@/core';

import { bool, int01, metaFromRow, num, str } from './rows';
import type { SqlExecutor, SqlRow } from './sql';
import type { RepoDeps } from './subjects';
import type { SyncedMeta } from './types';

/** P2a JSON_CAPS.definition: the cloud rejects longer definitions (v3 packs are about 2 KB). */
export const PACK_DEFINITION_MAX_CHARS = 50_000;
/** Erased definition kept on a tombstone (the cloud needs a JSON object of 2+ chars). */
export const ERASED_DEFINITION = '{}';
/** Custom pack ids (stylepacks CUSTOM_PACK_ID), checked again here so no other id can be written. */
const CUSTOM_ID = /^ref-[a-z2-7]{20}$/;

export interface StoredPack extends SyncedMeta {
  /** Bumped on every change of the definition (cloud: version). */
  version: number;
  /** The pack as a JSON string (validated by the caller before use). */
  definition: string;
  createdFromReference: boolean;
}

function packOf(r: SqlRow): StoredPack {
  return { ...metaFromRow(r), version: num(r.version), definition: str(r.definition), createdFromReference: bool(r.createdFromReference) };
}

/** Serialises a definition and enforces the cloud cap. */
function serialise(definition: unknown): string {
  if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
    throw new AppError('validation_failed', 'That look is not valid.');
  }
  const json = JSON.stringify(definition);
  if (json.length > PACK_DEFINITION_MAX_CHARS) throw new AppError('validation_failed', 'That look is too large to save.');
  return json;
}

export function createStylePacksRepo(deps: RepoDeps) {
  const get = async (ex: SqlExecutor, id: string): Promise<StoredPack | null> => {
    const r = await ex.get('SELECT * FROM stylePacks WHERE id = ?', [id]);
    return r ? packOf(r) : null;
  };

  return {
    get,

    /** Live custom packs, newest first. */
    async list(ex: SqlExecutor): Promise<StoredPack[]> {
      return (await ex.all('SELECT * FROM stylePacks WHERE deleted = 0 ORDER BY updated DESC, id')).map(packOf);
    },

    /** Creates or replaces a custom pack's definition (version + 1 on replace). */
    async save(tx: SqlExecutor, input: { id: string; definition: unknown; createdFromReference: boolean }): Promise<StoredPack> {
      if (!CUSTOM_ID.test(input.id) || !ENTITY_ID_PATTERN.test(input.id)) throw new AppError('validation_failed', 'That look is not valid.');
      const json = serialise(input.definition);
      const t = deps.now();
      const cur = await get(tx, input.id);
      if (!cur) {
        await tx.run(
          `INSERT INTO stylePacks (id, owner, schemaVersion, created, updated, rev, deleted, version, definition, createdFromReference)
           VALUES (?, NULL, 1, ?, ?, 0, 0, 1, ?, ?)`,
          [input.id, t, t, json, int01(input.createdFromReference)],
        );
      } else {
        if (cur.deleted) throw new AppError('not_found', 'That look was deleted.');
        await tx.run('UPDATE stylePacks SET definition = ?, version = ?, updated = ? WHERE id = ?', [
          json,
          Math.min(999, cur.version + 1),
          Math.max(t, cur.updated),
          input.id,
        ]);
      }
      return (await get(tx, input.id)) as StoredPack;
    },

    /**
     * Deletes a custom pack: a tombstone (deleted = 1) with the definition
     * ERASED, so "deleted" is true in the cloud too (C1 finding). Notes and
     * subjects using it move to `fallbackPackId`, in the same transaction.
     * Returns how many notes moved.
     */
    async remove(tx: SqlExecutor, id: string, fallbackPackId: string): Promise<number> {
      const cur = await get(tx, id);
      if (!cur || cur.deleted) return 0;
      const t = deps.now();
      await tx.run('UPDATE stylePacks SET deleted = 1, definition = ?, updated = ? WHERE id = ?', [ERASED_DEFINITION, Math.max(t, cur.updated), id]);
      const moved = await tx.run('UPDATE notes SET stylePackId = ?, updated = ? WHERE stylePackId = ?', [fallbackPackId, t, id]);
      await tx.run('UPDATE subjects SET defaultPack = NULL, updated = ? WHERE defaultPack = ?', [t, id]);
      return moved.changes;
    },
  };
}
