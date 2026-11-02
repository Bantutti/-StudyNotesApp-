import { createSyncScheduler, SCHEDULE } from '../scheduler';

describe('sync scheduler (Q3)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('syncs on foreground and every 2 minutes, and stops in the background', () => {
    const run = jest.fn(async () => undefined);
    const s = createSyncScheduler(run);
    s.appForeground();
    expect(run).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(SCHEDULE.intervalMs * 3);
    expect(run).toHaveBeenCalledTimes(4);
    s.appBackground();
    expect(run).toHaveBeenCalledTimes(5);
    jest.advanceTimersByTime(SCHEDULE.intervalMs * 3);
    expect(run).toHaveBeenCalledTimes(5);
  });

  it('typing syncs at most once per 30 s; leaving the note syncs at once', () => {
    const run = jest.fn(async () => undefined);
    const s = createSyncScheduler(run);
    for (let i = 0; i < 10; i++) {
      s.noteEdited();
      jest.advanceTimersByTime(2_000);
    }
    expect(run).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(SCHEDULE.editDelayMs);
    expect(run).toHaveBeenCalledTimes(1);
    s.noteEdited();
    s.noteLeft();
    expect(run).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(SCHEDULE.editDelayMs);
    expect(run).toHaveBeenCalledTimes(2); // the pending edit sync was folded into "left"
  });

  it('stop() cancels everything, and a failing run does not throw', () => {
    const run = jest.fn(async () => {
      throw new Error('offline');
    });
    const s = createSyncScheduler(run);
    s.appForeground();
    s.noteEdited();
    s.stop();
    jest.advanceTimersByTime(SCHEDULE.intervalMs * 2);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
