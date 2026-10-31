/**
 * App data lifecycle (logic only; the React wrapper is AppDataContext.tsx).
 *
 * - Opens the store (expo-sqlite on devices; any SqlDriver in tests).
 * - A tiny change bus so screens reload after writes (dataVersion).
 * - Undo controller: one pending delete at a time, shown as a snackbar for
 *   UNDO_WINDOW_MS; afterwards (or when the app goes to the background)
 *   the deleted text is wiped (decision Q11).
 * - resetAll(): "Delete all data".
 */
import * as z from 'zod';

import type { IdGenerator, Logger } from '@/core';
import { openStore, UNDO_WINDOW_MS, type SqlDriver, type Store, type UndoToken } from '@/modules/store';

export const KV_APP = 'app';
export const KEY_ONBOARDED = 'onboarded';
export const KEY_DEV_MENU = 'devMenu';
export const KEY_LAST_NOTE = 'lastNote';

export interface AppDataDeps {
  openDriver: () => Promise<SqlDriver>;
  deleteDatabase: () => Promise<void>;
  /** Removes app files outside the database (P0 spike results, recordings). */
  wipeFiles: () => Promise<void>;
  /** Removes secrets kept outside the database (the dev Groq key). */
  wipeSecrets: () => Promise<void>;
  ids: IdGenerator;
  logger: Logger;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/** Something the snackbar can undo: a store delete (token) or any action (run). */
export interface PendingUndo {
  message: string;
  token?: UndoToken;
  run?: () => Promise<void>;
}

export function createChangeBus() {
  let version = 0;
  const subs = new Set<(v: number) => void>();
  return {
    get version() {
      return version;
    },
    emit() {
      version += 1;
      subs.forEach((f) => f(version));
    },
    subscribe(fn: (v: number) => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}
export type ChangeBus = ReturnType<typeof createChangeBus>;

/**
 * One pending undo at a time. A new delete replaces the old one (whose undo
 * window simply continues; it is purged by the store's time cutoff).
 */
export function createUndoController(deps: {
  getStore: () => Store | null;
  bus: ChangeBus;
  onPendingChange: (p: PendingUndo | null) => void;
  logger: Logger;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}) {
  const setT = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let pending: PendingUndo | null = null;
  let timer: unknown = null;

  const set = (p: PendingUndo | null) => {
    pending = p;
    deps.onPendingChange(p);
  };

  const purge = async (immediate: boolean) => {
    const store = deps.getStore();
    if (!store) return;
    try {
      const n = await store.purge(immediate);
      if (n) deps.logger.info('undo.purged', { count: n });
    } catch {
      deps.logger.warn('undo.purge_failed');
    }
  };

  return {
    get pending() {
      return pending;
    },
    show(message: string, token: UndoToken) {
      this.showPending({ message, token });
    },
    /** Undo for an editor action (Beautify, template, AI): restores the previous document. */
    showAction(message: string, run: () => Promise<void>) {
      this.showPending({ message, run });
    },
    showPending(p: PendingUndo) {
      if (timer !== null) clearT(timer);
      set(p);
      deps.bus.emit();
      timer = setT(() => {
        timer = null;
        set(null);
        if (p.token) void purge(false);
      }, UNDO_WINDOW_MS + 250);
    },
    async undo(): Promise<boolean> {
      const p = pending;
      const store = deps.getStore();
      if (!p || !store) return false;
      if (timer !== null) clearT(timer);
      timer = null;
      set(null);
      let ok = true;
      if (p.run) await p.run();
      else if (p.token) ok = await store.undo(p.token);
      deps.bus.emit();
      return ok;
    },
    /** App went to the background: forfeit undo and wipe now (privacy first). */
    async flush() {
      if (timer !== null) clearT(timer);
      timer = null;
      if (pending) set(null);
      await purge(true);
    },
    dispose() {
      if (timer !== null) clearT(timer);
      timer = null;
    },
  };
}
export type UndoController = ReturnType<typeof createUndoController>;

export async function openAppStore(deps: AppDataDeps): Promise<Store> {
  const driver = await deps.openDriver();
  return openStore(driver, { ids: deps.ids, logger: deps.logger, now: deps.now });
}

/** "Delete all data": wipe rows, close, delete the file, wipe files and secrets, reopen empty. */
export async function resetAllData(store: Store, deps: AppDataDeps): Promise<Store> {
  await store.wipeAll();
  await store.close();
  await deps.deleteDatabase();
  await deps.wipeFiles();
  await deps.wipeSecrets();
  deps.logger.info('app.reset_all');
  return openAppStore(deps);
}

export const isOnboarded = async (store: Store) => (await store.kv.get(KV_APP, KEY_ONBOARDED, z.boolean())) === true;

/** Counts taps (e.g. on the version number) to unlock the developer menu: 7 taps within 3 s. */
export function createTapUnlock(opts: { taps?: number; windowMs?: number; now?: () => number } = {}) {
  const need = opts.taps ?? 7;
  const windowMs = opts.windowMs ?? 3_000;
  const now = opts.now ?? Date.now;
  let times: number[] = [];
  return {
    /** Returns how many taps remain (0 = unlocked by this tap). */
    tap(): number {
      const t = now();
      times = [...times.filter((x) => t - x <= windowMs), t];
      const left = Math.max(0, need - times.length);
      if (left === 0) times = [];
      return left;
    },
  };
}

export type AppDataStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; store: Store }
  | { kind: 'error'; message: string };

export interface AppDataSnapshot {
  status: AppDataStatus;
  pending: PendingUndo | null;
}

/**
 * Plain (non-React) controller for the whole data lifecycle. React reads it
 * with useSyncExternalStore; tests drive it directly.
 */
export function createAppDataController(deps: AppDataDeps, toMessage: (e: unknown) => string) {
  let snap: AppDataSnapshot = { status: { kind: 'loading' }, pending: null };
  let store: Store | null = null;
  const subs = new Set<() => void>();
  const update = (next: Partial<AppDataSnapshot>) => {
    snap = { ...snap, ...next };
    subs.forEach((f) => f());
  };
  const bus = createChangeBus();
  const undo = createUndoController({
    getStore: () => store,
    bus,
    onPendingChange: (pending) => update({ pending }),
    logger: deps.logger,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
  });
  let opening: Promise<void> | null = null;

  return {
    bus,
    undo,
    getSnapshot: () => snap,
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    open(): Promise<void> {
      if (opening) return opening;
      update({ status: { kind: 'loading' } });
      opening = openAppStore(deps)
        .then((s) => {
          store = s;
          update({ status: { kind: 'ready', store: s } });
        })
        .catch((e: unknown) => {
          deps.logger.error('app.store_open_failed');
          update({ status: { kind: 'error', message: toMessage(e) } });
        })
        .finally(() => {
          opening = null;
        });
      return opening;
    },
    async resetAll(): Promise<void> {
      if (!store) return;
      undo.dispose();
      update({ pending: null });
      const old = store;
      store = null;
      update({ status: { kind: 'loading' } });
      try {
        store = await resetAllData(old, deps);
        update({ status: { kind: 'ready', store } });
      } catch (e) {
        deps.logger.error('app.reset_failed');
        update({ status: { kind: 'error', message: toMessage(e) } });
      }
      bus.emit();
    },
    dispose() {
      undo.dispose();
    },
  };
}
export type AppDataController = ReturnType<typeof createAppDataController>;
