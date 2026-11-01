/**
 * Ink wiring (P4b): adapts the Store to the ink module's InkStorePort and
 * creates one InkService per open Store.
 *
 * Start-up work runs once per Store: recover() publishes drawings left
 * unpublished by a crash, then sweepOrphans() tombstones ink of notes that
 * are gone. "Delete all data" reopens the Store, which gives a fresh service.
 * The per-Store cache is a WeakMap, so a closed Store and its service are
 * garbage collected.
 */
import { listBlockIds, type IdGenerator, type Logger } from '@/core';
import { createInkService, expoInkFiles, type InkDownloadPort, type InkFilesPort, type InkService, type InkStorePort } from '@/modules/ink';
import type { Store } from '@/modules/store';

/** Store -> the slice the ink service uses. */
export function inkStorePort(store: Store): InkStorePort {
  return {
    async getNote(noteId) {
      const n = await store.notes.get(noteId);
      return n ? { id: n.id, deleted: n.deleted, inkLayerRef: n.inkLayerRef } : null;
    },
    async getAsset(assetId) {
      const a = await store.assets.get(assetId);
      return a ? { id: a.id, deleted: a.deleted, size: a.size, localPath: a.localPath } : null;
    },
    async createInkLayer(noteId, input) {
      const r = await store.assets.createInkLayer(noteId, input);
      return { noteUpdated: r.noteUpdated };
    },
    async setAssetSize(assetId, size) {
      await store.assets.update(assetId, { size });
    },
    removeAsset: (assetId) => store.assets.remove(assetId),
    setAssetLocalPath: (assetId, localPath) => store.assets.setLocalPath(assetId, localPath),
    async inkOrphans() {
      return (await store.assets.inkOrphans()).map((a) => ({ id: a.id, deleted: a.deleted, size: a.size, localPath: a.localPath }));
    },
    async recoverableBlockIds(noteId) {
      const ids = new Set<string>();
      const n = await store.notes.get(noteId);
      if (n) for (const id of listBlockIds(n.document)) ids.add(id);
      for (const meta of await store.versions.list(noteId)) {
        const v = await store.versions.get(meta.id);
        if (v) for (const id of listBlockIds(v.document)) ids.add(id);
      }
      return ids;
    },
  };
}

const cache = new WeakMap<Store, InkService>();

/** The InkService for a Store (created and started once per Store). */
export function inkServiceFor(
  store: Store,
  deps: { ids: IdGenerator; logger: Logger; files?: InkFilesPort; download?: InkDownloadPort },
): InkService {
  let svc = cache.get(store);
  if (!svc) {
    // download: P2b's pipeline plugs in here once merged (registerInkMerger + this port).
    const created = createInkService({ files: deps.files ?? expoInkFiles, store: inkStorePort(store), ids: deps.ids, logger: deps.logger, download: deps.download });
    cache.set(store, created);
    svc = created;
    void created
      .recover()
      .then(() => created.sweepOrphans())
      .catch(() => deps.logger.warn('ink.startup_failed'));
  }
  return svc;
}
