import { createLogger, createSeqIdGenerator, memorySink, userMessage } from '@/core';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { createAppDataController, createTapUnlock, isOnboarded, KEY_ONBOARDED, KV_APP, type AppDataDeps } from '../appData';

function fakeTimers() {
  let t = Date.UTC(2026, 10, 1);
  const queue: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      queue.push({ at: t + ms, fn, id: ++id });
      return id;
    },
    clearTimer: (h: unknown) => {
      const i = queue.findIndex((q) => q.id === h);
      if (i >= 0) queue.splice(i, 1);
    },
    advance(ms: number) {
      t += ms;
      for (const q of [...queue].sort((a, b) => a.at - b.at)) {
        if (q.at <= t) {
          queue.splice(queue.indexOf(q), 1);
          q.fn();
        }
      }
    },
  };
}

function deps(over: Partial<AppDataDeps> = {}) {
  const timers = fakeTimers();
  const calls: string[] = [];
  const d: AppDataDeps = {
    openDriver: async () => nodeSqliteDriver(),
    deleteDatabase: async () => void calls.push('deleteDatabase'),
    wipeFiles: async () => void calls.push('wipeFiles'),
    wipeSecrets: async () => void calls.push('wipeSecrets'),
    ids: createSeqIdGenerator(),
    logger: createLogger({ sink: memorySink() }),
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...over,
  };
  return { d, timers, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('app data controller', () => {
  it('opens the store and reports ready; first run is not onboarded', async () => {
    const { d } = deps();
    const ctl = createAppDataController(d, userMessage);
    expect(ctl.getSnapshot().status.kind).toBe('loading');
    await ctl.open();
    const s = ctl.getSnapshot().status;
    expect(s.kind).toBe('ready');
    if (s.kind === 'ready') expect(await isOnboarded(s.store)).toBe(false);
  });

  it('reports a friendly error when the database cannot open, and can retry', async () => {
    let fail = true;
    const { d } = deps({
      openDriver: async () => {
        if (fail) throw new Error('disk on fire /secret/path');
        return nodeSqliteDriver();
      },
    });
    const ctl = createAppDataController(d, userMessage);
    await ctl.open();
    const s = ctl.getSnapshot().status;
    expect(s).toEqual({ kind: 'error', message: 'Something went wrong. Please try again.' }); // no raw error text
    fail = false;
    await ctl.open();
    expect(ctl.getSnapshot().status.kind).toBe('ready');
  });

  it('undo restores a deleted note within the window', async () => {
    const { d } = deps();
    const ctl = createAppDataController(d, userMessage);
    await ctl.open();
    const st = ctl.getSnapshot().status;
    if (st.kind !== 'ready') throw new Error('not ready');
    const n = await st.store.notes.create({ stylePackId: 'pastel-highlight', title: 'Keep' });
    let changes = 0;
    ctl.bus.subscribe(() => changes++);
    ctl.undo.show('Note deleted', await st.store.notes.remove([n.id]));
    expect(ctl.getSnapshot().pending?.message).toBe('Note deleted');
    expect(await ctl.undo.undo()).toBe(true);
    expect(ctl.getSnapshot().pending).toBeNull();
    expect((await st.store.notes.get(n.id))?.deleted).toBe(false);
    expect(changes).toBe(2);
  });

  it('wipes deleted text when the window ends', async () => {
    const { d, timers } = deps();
    const ctl = createAppDataController(d, userMessage);
    await ctl.open();
    const st = ctl.getSnapshot().status;
    if (st.kind !== 'ready') throw new Error('not ready');
    const n = await st.store.notes.create({ stylePackId: 'pastel-highlight', title: 'Secret' });
    ctl.undo.show('Note deleted', await st.store.notes.remove([n.id]));
    timers.advance(8_300);
    await flush();
    await flush();
    expect(ctl.getSnapshot().pending).toBeNull();
    expect((await st.store.notes.get(n.id))?.title).toBe('');
  });

  it('going to the background forfeits undo and wipes at once', async () => {
    const { d } = deps();
    const ctl = createAppDataController(d, userMessage);
    await ctl.open();
    const st = ctl.getSnapshot().status;
    if (st.kind !== 'ready') throw new Error('not ready');
    const n = await st.store.notes.create({ stylePackId: 'pastel-highlight', title: 'Secret' });
    ctl.undo.show('Note deleted', await st.store.notes.remove([n.id]));
    await ctl.undo.flush();
    expect(ctl.getSnapshot().pending).toBeNull();
    expect((await st.store.notes.get(n.id))?.title).toBe('');
  });

  it('Delete all data wipes rows, files and secrets and reopens empty', async () => {
    const { d, calls } = deps();
    const ctl = createAppDataController(d, userMessage);
    await ctl.open();
    const st = ctl.getSnapshot().status;
    if (st.kind !== 'ready') throw new Error('not ready');
    await st.store.notes.create({ stylePackId: 'pastel-highlight', title: 'x' });
    await st.store.kv.set(KV_APP, KEY_ONBOARDED, true);
    await ctl.resetAll();
    expect(calls).toEqual(['deleteDatabase', 'wipeFiles', 'wipeSecrets']);
    const after = ctl.getSnapshot().status;
    expect(after.kind).toBe('ready');
    if (after.kind === 'ready') {
      expect(after.store).not.toBe(st.store);
      expect(await after.store.notes.list({ scope: 'all' })).toHaveLength(0);
      expect(await isOnboarded(after.store)).toBe(false);
    }
  });
});

describe('developer menu unlock', () => {
  it('needs 7 taps within 3 seconds', () => {
    let t = 0;
    const u = createTapUnlock({ now: () => t });
    for (let i = 0; i < 6; i++) {
      expect(u.tap()).toBe(6 - i);
      t += 100;
    }
    expect(u.tap()).toBe(0);
    t += 10_000;
    expect(u.tap()).toBe(6); // window expired, counting restarts
  });
});
