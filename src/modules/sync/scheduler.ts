/**
 * When syncs run (decision Q3: event-driven pulls, no live listeners).
 *
 * - App comes to the foreground (and at start): sync now, then every 2 min
 *   while the app stays open.
 * - Editing a note: at most one sync per 30 s while typing (the first edit
 *   starts the timer; later edits don't push it back).
 * - Leaving a note, or the app going to the background: sync now.
 * - The background stops the 2-minute timer.
 * Free tier: one pull is at least 10 reads (one per collection), so a pull
 * every 2 min for 8 open hours is about 2,400 reads a day (limit 50,000).
 * Timers are injected, so tests run on fake time.
 */
export interface SchedulerTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

export const SCHEDULE = { editDelayMs: 30_000, intervalMs: 120_000 } as const;

export interface SyncScheduler {
  appForeground(): void;
  appBackground(): void;
  noteEdited(): void;
  noteLeft(): void;
  stop(): void;
}

const realTimers: SchedulerTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export function createSyncScheduler(run: () => Promise<unknown>, timers: SchedulerTimers = realTimers, schedule = SCHEDULE): SyncScheduler {
  let editTimer: unknown = null;
  let interval: unknown = null;
  let stopped = false;
  const fire = () => {
    if (stopped) return;
    void run().catch(() => undefined); // the engine records its own errors
  };
  const clearEdit = () => {
    if (editTimer !== null) timers.clearTimeout(editTimer);
    editTimer = null;
  };
  const clearInterval = () => {
    if (interval !== null) timers.clearInterval(interval);
    interval = null;
  };
  return {
    appForeground() {
      stopped = false;
      fire();
      clearInterval();
      interval = timers.setInterval(fire, schedule.intervalMs);
    },
    appBackground() {
      clearEdit();
      clearInterval();
      fire();
    },
    noteEdited() {
      if (stopped || editTimer !== null) return;
      editTimer = timers.setTimeout(() => {
        editTimer = null;
        fire();
      }, schedule.editDelayMs);
    },
    noteLeft() {
      clearEdit();
      fire();
    },
    stop() {
      stopped = true;
      clearEdit();
      clearInterval();
    },
  };
}
