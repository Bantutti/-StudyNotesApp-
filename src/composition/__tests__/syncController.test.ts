/**
 * The app-side sync glue: nothing syncs before "Turn on sync", the confirm
 * counts, progress, another account refused, sign-out keeps notes, and the
 * account deleted elsewhere turns this phone's notes back into guest notes.
 */
import { createLogger, memorySink, type IdGenerator } from '@/core';
import type { AuthService, AuthState } from '@/modules/auth';
import { openStore } from '@/modules/store';
import { CloudTime, createAssetMergerRegistry, createFakeCloud, type SyncProgress } from '@/modules/sync';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { createSyncController } from '../syncController';

const UID = 'uid_controller_0000001';
const PACK = 'pastel-highlight';

function fakeAuth(initial: AuthState) {
  let s = initial;
  const subs = new Set<(s: AuthState) => void>();
  const auth = {
    state: () => s,
    subscribe(fn: (s: AuthState) => void) {
      subs.add(fn);
      fn(s);
      return () => subs.delete(fn);
    },
    signOut: jest.fn(async () => {
      s = { status: 'signedOut' };
      subs.forEach((f) => f(s));
    }),
  };
  const setState = (n: AuthState) => {
    s = n;
    subs.forEach((f) => f(n));
  };
  return { auth: auth as unknown as AuthService, setState };
}

function ids(): IdGenerator {
  let n = 0;
  return { newId: (p) => `${p}_C${String(++n).padStart(15, '0')}` };
}

const ready = (uid = UID): AuthState => ({ status: 'ready', uid, email: 'rey@example.com', provider: 'password' });
const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(state: AuthState = ready()) {
  const cloud = createFakeCloud();
  const { auth, setState } = fakeAuth(state);
  const logger = createLogger({ sink: memorySink(), minLevel: 'debug' });
  const store = await openStore(nodeSqliteDriver(), { ids: ids(), logger });
  const timers = { setTimeout: () => 0, clearTimeout: () => undefined, setInterval: () => 0, clearInterval: () => undefined };
  const remote = cloud.client(() => {
    const a = auth.state();
    return a.status === 'ready' ? { uid: a.uid, emailVerified: true } : null;
  });
  const ctl = createSyncController({ auth, remote, mergers: createAssetMergerRegistry(), ids: ids(), logger, timers });
  await ctl.attach(store);
  return { cloud, ctl, store, setState, auth };
}

describe('sync controller', () => {
  it('signed in but not turned on: shows what would upload, uploads nothing', async () => {
    const { ctl, store, cloud } = await setup();
    await store.notes.create({ stylePackId: PACK, title: 'a' });
    await store.notes.create({ stylePackId: PACK, title: 'b' });
    await store.subjects.create({ name: 'Bio', color: '4F7CF7' });
    await ctl.attach(store);
    expect(ctl.view()).toEqual({ kind: 'readyToTurnOn', email: 'rey@example.com', counts: { notes: 2, subjects: 1 } });
    expect(cloud.count()).toBe(0);
  });

  it('turn on: binds, uploads with progress, then shows "on"', async () => {
    const { ctl, store, cloud } = await setup();
    for (let i = 0; i < 3; i++) await store.notes.create({ stylePackId: PACK, title: `n${i}` });
    await ctl.attach(store);
    const steps: SyncProgress[] = [];
    const r = await ctl.turnOn({ onProgress: (p) => steps.push(p) });
    expect(r.status.phase).toBe('idle');
    expect(cloud.all('notes')).toHaveLength(3);
    expect(steps[0]).toMatchObject({ step: 'upload', done: 0, total: 4 }); // 3 notes + profile
    expect(steps.at(-1)).toMatchObject({ step: 'done' });
    expect(await store.sync.getState()).toMatchObject({ uid: UID, enabled: true, initialSyncDone: true });
    expect(ctl.view()).toMatchObject({ kind: 'on', status: { phase: 'idle', pending: 0 } });
  });

  it('nothing runs for an unverified email or when signed out', async () => {
    const { ctl, store, cloud, setState } = await setup({ status: 'unverified', uid: UID, email: 'rey@example.com', provider: 'password' });
    expect(ctl.view()).toEqual({ kind: 'unverified', email: 'rey@example.com' });
    await expect(ctl.turnOn()).rejects.toThrow('sign_in_first');
    setState({ status: 'signedOut' });
    await flush();
    expect(ctl.view()).toEqual({ kind: 'signedOut' });
    await store.notes.create({ stylePackId: PACK });
    expect(cloud.count()).toBe(0);
  });

  it('a different account is refused (one account per phone, Q7)', async () => {
    const { ctl, store, setState } = await setup();
    await ctl.turnOn();
    await ctl.signOut();
    setState(ready('uid_somebody_else_0001'));
    await flush();
    await flush();
    expect(ctl.view()).toMatchObject({ kind: 'otherAccount' });
    await expect(ctl.turnOn()).rejects.toThrow('other_account');
    expect((await store.sync.getState()).uid).toBe(UID);
  });

  it('sign-out uploads the last edits, stops sync and keeps notes and the binding', async () => {
    const { ctl, store, cloud, auth } = await setup();
    await ctl.turnOn();
    const n = await store.notes.create({ stylePackId: PACK, title: 'last' });
    await ctl.signOut();
    expect(cloud.peek('notes', n.id)).toBeDefined();
    expect(auth.signOut).toHaveBeenCalled();
    expect(await store.sync.getState()).toMatchObject({ uid: UID, enabled: false });
    expect(await store.notes.get(n.id)).toMatchObject({ title: 'last' });
    expect(ctl.view()).toEqual({ kind: 'signedOut' });
  });

  it('account deleted on another device: signs out, notes stay as guest notes', async () => {
    const { ctl, store, cloud, auth } = await setup();
    const n = await store.notes.create({ stylePackId: PACK, title: 'mine' });
    await ctl.turnOn();
    const p = cloud.peek('users', UID)!;
    cloud.adminSet('users', UID, { ...p, deletionRequestedAt: CloudTime.fromMillis(Date.now()) });
    await ctl.syncNow();
    await flush();
    await flush();
    expect(ctl.view()).toEqual({ kind: 'accountGone' });
    expect(auth.signOut).toHaveBeenCalled();
    expect(await store.notes.get(n.id)).toMatchObject({ title: 'mine', owner: null, rev: 0 });
    expect(await store.sync.getState()).toMatchObject({ uid: null, enabled: false });
    ctl.dismissAccountGone();
    await flush();
    expect(ctl.view()).toEqual({ kind: 'signedOut' });
  });

  it('restarts by itself after the app reopens (enabled + bound + signed in)', async () => {
    const { ctl, store } = await setup();
    await ctl.turnOn();
    ctl.detach();
    await ctl.attach(store);
    expect(ctl.view()).toMatchObject({ kind: 'on' });
    expect(await ctl.syncNow()).not.toBeNull();
  });
});
