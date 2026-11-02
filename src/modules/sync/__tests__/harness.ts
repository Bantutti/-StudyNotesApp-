/**
 * Two (or more) simulated devices for sync tests: each has its own SQLite
 * database (node:sqlite), its own id generator and its own connection to
 * one shared fake cloud. One clock drives everything.
 */
import { createLogger, memorySink, type IdGenerator } from '@/core';
import { openStore, type Store } from '@/modules/store';

import { nodeSqliteDriver } from '../../../../test/nodeSqlite';
import type { SyncContext } from '../context';
import { createAssetMergerRegistry, type AssetMergerRegistry, type AssetSyncDeps, type FileStorePort } from '../assets';
import { createSyncEngine, type SyncEngine } from '../engine';
import { createFakeCloud, type FakeAuth, type FakeClientControls, type FakeCloud } from '../fakeRemote';
import type { RemoteBackend } from '../ports';

export const UID = 'uid_alice_000000000001';
export const PACK = 'pastel-highlight';

export interface Clock {
  now: () => number;
  advance: (ms: number) => void;
}

export function makeClock(start = Date.UTC(2026, 10, 1, 8, 0, 0)): Clock {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/** Ids unique per device: n_A00000000000001 vs n_B00000000000001. */
export function deviceIds(dev: string): IdGenerator {
  let n = 0;
  return { newId: (prefix) => `${prefix}_${dev}${String(++n).padStart(15 - dev.length + 1, '0')}` };
}

export interface Device {
  name: string;
  store: Store;
  engine: SyncEngine;
  remote: RemoteBackend & FakeClientControls;
  ctx: SyncContext;
  auth: FakeAuth | null;
  /** Bind to the account and turn sync on (what "Turn on sync" does after sign-in). */
  enable(): Promise<void>;
  sync(): ReturnType<SyncEngine['syncNow']>;
  logs: ReturnType<typeof memorySink>;
  /** The device's files (memory) and its merger registry. */
  files: Map<string, Uint8Array>;
  mergers: AssetMergerRegistry;
  assetDeps: AssetSyncDeps;
  /** The device database (for assertions only). */
  raw: ReturnType<typeof nodeSqliteDriver>['raw'];
}

export async function makeDevice(
  cloud: FakeCloud,
  clock: Clock,
  name: string,
  opts: { uid?: string; verified?: boolean; limits?: SyncContext['limits'] } = {},
): Promise<Device> {
  const uid = opts.uid ?? UID;
  const logs = memorySink(1000);
  const logger = createLogger({ sink: logs, minLevel: 'debug' });
  const ids = deviceIds(name);
  const driver = nodeSqliteDriver();
  const store = await openStore(driver, { ids, logger, now: clock.now });
  const dev: Partial<Device> & { auth: FakeAuth | null } = { name, auth: { uid, emailVerified: opts.verified ?? true } };
  const remote = cloud.client(() => dev.auth);
  const ctx: SyncContext = { local: store.sync, remote, uid, ids, now: clock.now, logger, ...(opts.limits ? { limits: opts.limits } : {}) };
  const files = new Map<string, Uint8Array>();
  const fileStore: FileStorePort = {
    read: async (p) => (files.has(p) ? new Uint8Array(files.get(p) as Uint8Array) : null),
    write: async (p, b) => {
      files.set(p, new Uint8Array(b));
    },
    remove: async (p) => {
      files.delete(p);
    },
    pathFor: ({ id, ext }) => `file:///${name}/${id}.${ext}`,
  };
  const mergers = createAssetMergerRegistry();
  const blobs = cloud.blobs(() => dev.auth);
  const assetDeps: AssetSyncDeps = { files: fileStore, blobs, mergers };
  const engine = createSyncEngine(ctx, { assets: assetDeps });
  Object.assign(dev, {
    store,
    engine,
    remote,
    ctx,
    logs,
    files,
    mergers,
    assetDeps,
    raw: driver.raw,
    enable: async () => {
      await store.sync.run(async (s) => {
        await s.bind(uid);
        await s.setEnabled(true);
      });
    },
    sync: () => engine.syncNow(),
  });
  return dev as Device;
}

export async function setup(n = 2, opts: Parameters<typeof makeDevice>[3] = {}) {
  const clock = makeClock();
  const cloud = createFakeCloud({ now: clock.now });
  const names = ['A', 'B', 'C', 'D'].slice(0, n);
  const devices: Device[] = [];
  for (const name of names) devices.push(await makeDevice(cloud, clock, name, opts));
  return { clock, cloud, devices, A: devices[0] as Device, B: devices[1] as Device };
}

/** Comparable snapshot of a device's synced rows (cloud fields only; owner, timestamps and local-only columns dropped). */
export function snapshot(d: Device, tables: readonly string[] = ['subjects', 'folders', 'notes', 'cards', 'reviewLogs']) {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of tables) {
    // Rows created and deleted before they were ever uploaded (rev 0) stay on their own device only.
    const where = t === 'reviewLogs' ? '' : 'WHERE NOT (deleted = 1 AND rev = 0)';
    const rows = d.raw.prepare(`SELECT * FROM ${t} ${where} ORDER BY id`).all() as Record<string, unknown>[];
    out[t] = rows.map(({ created: _c, updated: _u, owner: _o, ...rest }) => rest);
  }
  return out;
}

/** Runs sync on every device until nothing is left to upload (or `max` rounds). */
export async function settle(devices: Device[], max = 6): Promise<void> {
  for (let i = 0; i < max; i++) {
    for (const d of devices) await d.sync();
    const pending = await Promise.all(devices.map(async (d) => (await d.store.sync.listOutbox({ limit: 1 })).length));
    if (pending.every((p) => p === 0)) {
      for (const d of devices) await d.sync();
      return;
    }
  }
}
