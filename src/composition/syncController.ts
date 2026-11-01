/**
 * Sync as the app sees it (P2b): ties auth, the local store and the sync
 * engine together, and gives screens one small view model.
 *
 * - Nothing syncs until the person turns sync on (plan Flow 8). Before
 *   anything uploads, the confirm screen shows what will go up (Q-plan §4,
 *   plan §17 "confirmation screen with counts").
 * - It runs only for a verified account the database is bound to (Q7).
 * - The account deleted on another device: sync stops, this phone signs
 *   out, and the notes stay here as guest notes (P2a §A.2.1 for the other
 *   device). The screen explains once ("accountGone").
 * - Signing out keeps notes and binding; sync just stops.
 * No logs carry emails, titles or content.
 */
import type { IdGenerator, Logger } from '@/core';
import { bindAccount, type AuthService, type AuthState } from '@/modules/auth';
import type { Store, SyncTable } from '@/modules/store';
import {
  createSyncEngine,
  createSyncScheduler,
  type AssetMergerRegistry,
  type BlobStorePort,
  type ConflictChoice,
  type FileStorePort,
  type RemoteBackend,
  type SchedulerTimers,
  type SyncEngine,
  type SyncProgress,
  type SyncRunResult,
  type SyncScheduler,
  type SyncStatus,
} from '@/modules/sync';

/** What "Turn on sync" will upload (the confirm screen). Users/profile excluded. */
export type UploadCounts = Partial<Record<Exclude<SyncTable, 'users'>, number>>;

export type SyncView =
  | { kind: 'off' }
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'unverified'; email: string | null }
  | { kind: 'otherAccount'; email: string | null }
  | { kind: 'readyToTurnOn'; email: string | null; counts: UploadCounts }
  | { kind: 'on'; email: string | null; status: SyncStatus }
  | { kind: 'accountGone' };

export interface SyncControllerDeps {
  auth: AuthService;
  remote: RemoteBackend;
  files?: FileStorePort;
  blobs?: BlobStorePort;
  mergers: AssetMergerRegistry;
  ids: IdGenerator;
  logger: Logger;
  now?: () => number;
  timers?: SchedulerTimers;
}

export interface SyncController {
  view(): SyncView;
  subscribe(fn: (v: SyncView) => void): () => void;
  /** Called by the data provider whenever the store opens (or reopens after Delete all data). */
  attach(store: Store): Promise<void>;
  detach(): void;
  /** "Turn on sync": bind, then upload everything with progress. */
  turnOn(opts?: { onProgress?: (p: SyncProgress) => void }): Promise<SyncRunResult>;
  /** Stop syncing on this phone (keeps notes and the account link). */
  pause(): Promise<void>;
  signOut(): Promise<void>;
  syncNow(): Promise<SyncRunResult | null>;
  resolve(tbl: SyncTable, id: string, choice: ConflictChoice): Promise<{ copyId: string | null }>;
  ensureLocalFile(id: string): Promise<string>;
  /** Editor and app lifecycle hooks (scheduler). */
  noteOpened(noteId: string): void;
  noteEdited(): void;
  noteLeft(): void;
  appActive(active: boolean): void;
  /** Ids of notes changed by a pull (an open editor reloads). */
  onNotesChanged(fn: (ids: string[]) => void): () => void;
  dismissAccountGone(): void;
}

const emailOf = (s: AuthState): string | null => (s.status === 'ready' || s.status === 'unverified' ? s.email : null);

export function createSyncController(deps: SyncControllerDeps): SyncController {
  const log = deps.logger.child('sync');
  let store: Store | null = null;
  let engine: SyncEngine | null = null;
  let scheduler: SyncScheduler | null = null;
  let engineUid: string | null = null;
  let view: SyncView = { kind: 'loading' };
  let accountGone = false;
  let active = true;
  const subs = new Set<(v: SyncView) => void>();
  const noteSubs = new Set<(ids: string[]) => void>();
  let unsubs: (() => void)[] = [];

  const set = (v: SyncView) => {
    view = v;
    subs.forEach((f) => f(v));
  };

  const stopEngine = () => {
    scheduler?.stop();
    unsubs.forEach((u) => u());
    unsubs = [];
    scheduler = null;
    engine = null;
    engineUid = null;
  };

  const onAccountGone = async () => {
    if (!store) return;
    log.warn('account_gone');
    stopEngine();
    accountGone = true;
    await store.sync.resetToGuest(); // notes stay, as guest notes
    await deps.auth.signOut().catch(() => undefined);
    set({ kind: 'accountGone' });
  };

  const startEngine = (uid: string) => {
    if (!store || (engine && engineUid === uid)) return;
    stopEngine();
    const assets = deps.files && deps.blobs ? { files: deps.files, blobs: deps.blobs, mergers: deps.mergers } : undefined;
    engine = createSyncEngine(
      { local: store.sync, remote: deps.remote, uid, ids: deps.ids, now: deps.now ?? Date.now, logger: deps.logger },
      assets ? { assets } : {},
    );
    engineUid = uid;
    unsubs.push(
      engine.subscribe((status) => {
        if (status.phase === 'account_gone') void onAccountGone();
        else set({ kind: 'on', email: emailOf(deps.auth.state()), status });
      }),
      engine.onNotesChanged((ids) => noteSubs.forEach((f) => f(ids))),
    );
    scheduler = createSyncScheduler(() => engine?.syncNow() ?? Promise.resolve(), deps.timers);
    if (active) scheduler.appForeground();
  };

  const uploadCounts = async (s: Store): Promise<UploadCounts> => {
    const { users: _users, ...rest } = await s.sync.countOutbox('pending');
    return rest;
  };

  /** Recomputes the view from auth + store state; starts or stops the engine. */
  const refresh = async (): Promise<void> => {
    if (accountGone) return set({ kind: 'accountGone' });
    const a = deps.auth.state();
    if (!store || a.status === 'loading') return set({ kind: 'loading' });
    if (a.status === 'signedOut') {
      stopEngine();
      return set({ kind: 'signedOut' });
    }
    if (a.status === 'unverified') {
      stopEngine();
      return set({ kind: 'unverified', email: a.email });
    }
    const st = await store.sync.getState();
    if (st.uid !== null && st.uid !== a.uid) {
      stopEngine();
      return set({ kind: 'otherAccount', email: a.email });
    }
    if (!st.enabled) {
      stopEngine();
      return set({ kind: 'readyToTurnOn', email: a.email, counts: await uploadCounts(store) });
    }
    startEngine(a.uid);
    if (engine) set({ kind: 'on', email: a.email, status: await engine.status() });
  };

  const requireEngine = (): SyncEngine => {
    if (!engine) throw new Error('sync_not_running');
    return engine;
  };

  deps.auth.subscribe(() => {
    void refresh();
  });

  return {
    view: () => view,
    subscribe(fn) {
      subs.add(fn);
      fn(view);
      return () => {
        subs.delete(fn);
      };
    },

    async attach(s) {
      stopEngine();
      store = s;
      await refresh();
    },

    detach() {
      stopEngine();
      store = null;
    },

    async turnOn(opts = {}) {
      const a = deps.auth.state();
      if (!store || a.status !== 'ready') throw new Error('sign_in_first');
      const bound = await bindAccount(store, a.uid);
      if (!bound.ok) {
        await refresh();
        throw new Error('other_account');
      }
      await store.sync.setEnabled(true);
      startEngine(a.uid);
      const r = await requireEngine().syncNow(opts);
      if (r.status.phase === 'idle') await store.sync.setInitialSyncDone(true);
      log.info('turned_on', { phase: r.status.phase, uploaded: r.push?.uploaded ?? 0 });
      return r;
    },

    async pause() {
      if (store) await store.sync.setEnabled(false);
      stopEngine();
      await refresh();
    },

    async signOut() {
      if (engine) await engine.syncNow().catch(() => undefined); // last upload before leaving
      if (store) await store.sync.setEnabled(false);
      stopEngine();
      await deps.auth.signOut();
      await refresh();
    },

    async syncNow() {
      return engine ? engine.syncNow() : null;
    },

    async resolve(tbl, id, choice) {
      const r = await requireEngine().resolve(tbl, id, choice);
      void engine?.syncNow();
      return r;
    },

    ensureLocalFile: (id) => requireEngine().ensureLocalFile(id),

    noteOpened(noteId) {
      void engine?.refreshOne('notes', noteId).catch(() => undefined);
    },
    noteEdited() {
      scheduler?.noteEdited();
    },
    noteLeft() {
      scheduler?.noteLeft();
    },
    appActive(isActive) {
      active = isActive;
      if (isActive) scheduler?.appForeground();
      else scheduler?.appBackground();
    },

    onNotesChanged(fn) {
      noteSubs.add(fn);
      return () => {
        noteSubs.delete(fn);
      };
    },

    dismissAccountGone() {
      accountGone = false;
      void refresh();
    },
  };
}
