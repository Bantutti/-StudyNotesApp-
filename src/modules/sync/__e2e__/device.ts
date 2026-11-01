/** A simulated device for the e2e suite: its own Firebase app instance, SQLite database and files. */
import { createLogger, memorySink, type IdGenerator } from '@/core';
import { createFirestoreRemote, createStorageBlobs, type CloudServices } from '@/modules/cloud';
import { openStore, type Store } from '@/modules/store';
import { createAssetMergerRegistry, createSyncEngine, type AssetMergerRegistry, type AssetSyncDeps, type SyncContext, type SyncEngine } from '@/modules/sync';

import { cloudFor } from '../../../../test/e2e/emulator';
import { nodeSqliteDriver } from '../../../../test/nodeSqlite';

export interface E2EDevice {
  name: string;
  cloud: CloudServices;
  store: Store;
  raw: ReturnType<typeof nodeSqliteDriver>['raw'];
  files: Map<string, Uint8Array>;
  mergers: AssetMergerRegistry;
  /** Builds the engine for the signed-in uid and binds + enables sync. */
  start(uid: string): Promise<SyncEngine>;
  engine(): SyncEngine;
  ctx(): SyncContext;
  close(): Promise<void>;
}

function ids(dev: string): IdGenerator {
  let k = 0;
  const run = Math.random().toString(36).slice(2, 8);
  return { newId: (p) => `${p}_${dev}${run}${String(++k).padStart(10, '0')}` };
}

export async function makeE2EDevice(name: string): Promise<E2EDevice> {
  const cloud = cloudFor(name);
  const driver = nodeSqliteDriver();
  const logger = createLogger({ sink: memorySink(1000), minLevel: 'debug' });
  const idg = ids(name);
  const store = await openStore(driver, { ids: idg, logger });
  const files = new Map<string, Uint8Array>();
  const mergers = createAssetMergerRegistry();
  const assets: AssetSyncDeps = {
    files: {
      read: async (p) => (files.has(p) ? new Uint8Array(files.get(p) as Uint8Array) : null),
      write: async (p, b) => void files.set(p, new Uint8Array(b)),
      remove: async (p) => void files.delete(p),
      pathFor: ({ id, ext }) => `file:///${name}/${id}.${ext}`,
    },
    blobs: createStorageBlobs(cloud.storage),
    mergers,
  };
  let engine: SyncEngine | null = null;
  let ctx: SyncContext | null = null;
  return {
    name,
    cloud,
    store,
    raw: driver.raw,
    files,
    mergers,
    async start(uid) {
      ctx = { local: store.sync, remote: createFirestoreRemote(cloud.firestore, { timeoutMs: 15_000 }), uid, ids: idg, now: Date.now, logger };
      engine = createSyncEngine(ctx, { assets });
      await store.sync.run(async (s) => {
        await s.bind(uid);
        await s.setEnabled(true);
      });
      return engine;
    },
    engine: () => {
      if (!engine) throw new Error('not started');
      return engine;
    },
    ctx: () => {
      if (!ctx) throw new Error('not started');
      return ctx;
    },
    async close() {
      await cloud.close();
      await store.close();
    },
  };
}
