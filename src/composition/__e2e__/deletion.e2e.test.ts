/**
 * Exit criterion: "account deletion leaves nothing behind". Two phones sync
 * notes, a card, a review log and an ink file; phone A deletes the account
 * in the app. Afterwards the emulators hold 0 documents, 0 Storage files and
 * 0 Auth users (checked as the admin through the REST APIs), phone A keeps
 * its notes as guest notes, and phone B stops syncing cleanly.
 */
import { createLogger, memorySink, type IdGenerator } from '@/core';
import { createAuthService, deleteAccountAndCloudData, unavailableApple, unavailableGoogle } from '@/modules/auth';
import { createFirestoreRemote, createStorageBlobs } from '@/modules/cloud';
import { openStore } from '@/modules/store';
import { createAssetMergerRegistry, type FileStorePort } from '@/modules/sync';

import { clickVerificationLinks, cloudFor, countAllDocs, countAuthUsers, countStorageFiles, resetEmulators } from '../../../test/e2e/emulator';
import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { createSyncController } from '../syncController';

const PW = 'correct horse battery 9';
const crypto = { randomHex: () => 'ab'.repeat(32), sha256Hex: async (s: string) => s };
const timers = { setTimeout: () => 0, clearTimeout: () => undefined, setInterval: () => 0, clearInterval: () => undefined };
const closers: (() => Promise<void>)[] = [];

function ids(dev: string): IdGenerator {
  let n = 0;
  const run = Math.random().toString(36).slice(2, 7);
  return { newId: (p) => `${p}_${dev}${run}${String(++n).padStart(10, '0')}` };
}

async function phone(name: string) {
  const cloud = cloudFor(name);
  const logger = createLogger({ sink: memorySink(), minLevel: 'debug' });
  const auth = createAuthService({ auth: cloud.auth, google: unavailableGoogle, apple: unavailableApple, crypto, logger });
  const raw = nodeSqliteDriver();
  const store = await openStore(raw, { ids: ids(name), logger });
  const fileMap = new Map<string, Uint8Array>();
  const files: FileStorePort = {
    read: async (p) => fileMap.get(p) ?? null,
    write: async (p, b) => void fileMap.set(p, b),
    remove: async (p) => void fileMap.delete(p),
    pathFor: ({ id, ext }) => `file:///${name}/${id}.${ext}`,
  };
  const ctl = createSyncController({
    auth, remote: createFirestoreRemote(cloud.firestore), blobs: createStorageBlobs(cloud.storage), files,
    mergers: createAssetMergerRegistry(), ids: ids(`${name}x`), logger, timers,
  });
  await ctl.attach(store);
  closers.push(async () => {
    ctl.detach();
    await cloud.close();
    await store.close();
  });
  return { cloud, auth, store, ctl, raw: raw.raw, fileMap, logger };
}

const settle = () => new Promise((r) => setTimeout(r, 50));
beforeEach(resetEmulators);
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

it('deleting the account in the app leaves nothing in the cloud', async () => {
  const A = await phone('A');
  const email = `delete.${Date.now()}@example.com`;
  await A.auth.signUpWithEmail(email, PW);
  await clickVerificationLinks(email);
  await A.auth.checkVerified();
  await settle();
  const n = await A.store.notes.create({ stylePackId: 'pastel-highlight', title: 'Keep me locally' });
  await A.store.subjects.create({ name: 'Chem', color: '4F7CF7' });
  const now = Date.now();
  A.raw.exec(`INSERT INTO cards (id, created, updated, type, front, back, source) VALUES ('c_E2E0000000000001', ${now}, ${now}, 'basic', 'Q', 'A', 'manual')`);
  A.raw.exec(`INSERT INTO reviewLogs (id, created, card, rating, reviewedAt, device) VALUES ('r_E2E0000000000001', ${now}, 'c_E2E0000000000001', 3, ${now}, 'devA')`);
  A.fileMap.set('file:///A/ink.json', new TextEncoder().encode('["s1"]'));
  A.raw.exec(`INSERT INTO assets (id, created, updated, type, size, localPath) VALUES ('a_E2E0000000000001', ${now}, ${now}, 'ink', 0, 'file:///A/ink.json')`);
  const r = await A.ctl.turnOn();
  expect(r.status).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
  expect(await countStorageFiles()).toBe(1); // the ink file went up (in this run or the scheduler's)

  const B = await phone('B');
  await B.auth.signInWithEmail(email, PW);
  await settle();
  await B.ctl.turnOn();
  expect((await countAllDocs()) > 5).toBe(true);
  expect(await countStorageFiles()).toBe(1);
  expect(await countAuthUsers()).toBe(1);

  // Phone A: re-sign-in, then delete.
  const { appleAuthorizationCode } = await A.auth.reauthenticate({ method: 'password', password: PW });
  const steps: string[] = [];
  const res = await deleteAccountAndCloudData(
    { auth: A.cloud.auth, firestore: A.cloud.firestore, storage: A.cloud.storage, logger: A.logger, stopSync: () => A.ctl.stopForDeletion() },
    A.store,
    { appleAuthorizationCode, onProgress: (p) => steps.push(p.step) },
  );
  await A.ctl.afterAccountDeleted();
  expect(res.appleRevoke).toBe('not_apple');
  expect(steps).toEqual(expect.arrayContaining(['mark', 'storage', 'firestore', 'profile', 'auth']));

  // Nothing left behind.
  expect(await countAllDocs()).toBe(0);
  expect(await countStorageFiles()).toBe(0);
  expect(await countAuthUsers()).toBe(0);

  // Phone A keeps its notes as guest notes.
  expect(await A.store.notes.get(n.id)).toMatchObject({ title: 'Keep me locally', owner: null, rev: 0 });
  expect(A.ctl.view()).toEqual({ kind: 'signedOut' });

  // Phone B: its next sync finds the account gone, stops, keeps the notes.
  await B.ctl.syncNow();
  await settle();
  expect(B.ctl.view()).toEqual({ kind: 'accountGone' });
  expect((await B.store.notes.list({ scope: 'all' })).map((x) => x.title)).toContain('Keep me locally');
  expect(await countAllDocs()).toBe(0); // and it uploaded nothing back
});
