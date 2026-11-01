/**
 * Plan Flow 8 end to end on the emulator: a guest's notes, sign-up, the
 * verification gate, "Turn on sync" with counts and progress, then a second
 * phone signing in to the same account and getting everything.
 */
import { createLogger, memorySink, type IdGenerator } from '@/core';
import { createAuthService, unavailableApple, unavailableGoogle } from '@/modules/auth';
import { createFirestoreRemote, createStorageBlobs } from '@/modules/cloud';
import { openStore } from '@/modules/store';
import { createAssetMergerRegistry } from '@/modules/sync';

import { clickVerificationLinks, cloudFor, resetEmulators } from '../../../test/e2e/emulator';
import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { createSyncController } from '../syncController';

const PW = 'correct horse battery 9';
const crypto = { randomHex: () => 'ef'.repeat(32), sha256Hex: async (s: string) => s };
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
  const store = await openStore(nodeSqliteDriver(), { ids: ids(name), logger });
  const ctl = createSyncController({
    auth,
    remote: createFirestoreRemote(cloud.firestore),
    blobs: createStorageBlobs(cloud.storage),
    mergers: createAssetMergerRegistry(),
    ids: ids(`${name}x`),
    logger,
    timers,
  });
  await ctl.attach(store);
  closers.push(async () => {
    ctl.detach();
    await cloud.close();
    await store.close();
  });
  return { auth, store, ctl };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(resetEmulators);
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

it('guest notes -> sign up -> verify -> turn on -> second phone gets them', async () => {
  const A = await phone('A');
  await A.store.subjects.create({ name: 'Physics', color: '4F7CF7' });
  for (let i = 0; i < 3; i++) await A.store.notes.create({ stylePackId: 'pastel-highlight', title: `Lecture ${i}` });
  expect(A.ctl.view()).toEqual({ kind: 'signedOut' });

  const email = `flow8.${Date.now()}@example.com`;
  await A.auth.signUpWithEmail(email, PW);
  await settle();
  expect(A.ctl.view()).toEqual({ kind: 'unverified', email });
  await clickVerificationLinks(email);
  await A.auth.checkVerified();
  await settle();
  expect(A.ctl.view()).toEqual({ kind: 'readyToTurnOn', email, counts: { notes: 3, subjects: 1 } });

  const steps: string[] = [];
  const r = await A.ctl.turnOn({ onProgress: (p) => steps.push(`${p.step}:${p.done}/${p.total}`) });
  expect(r.status).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
  expect(steps[0]).toBe('upload:0/5');
  expect(steps).toContain('upload:5/5');

  const B = await phone('B');
  await B.auth.signInWithEmail(email, PW);
  await settle();
  expect(B.ctl.view()).toMatchObject({ kind: 'readyToTurnOn', counts: {} });
  await B.ctl.turnOn();
  expect((await B.store.notes.list({ scope: 'all' })).map((n) => n.title).sort()).toEqual(['Lecture 0', 'Lecture 1', 'Lecture 2']);
  expect((await B.store.subjects.list()).map((s) => s.name)).toEqual(['Physics']);
});
