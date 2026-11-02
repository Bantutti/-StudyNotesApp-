import { DEFAULT_LOCK, initialLock, lockReducer, lockSettingsSchema } from '../lockMachine';

const on = { enabled: true, timeoutMs: 60_000 } as const;

describe('app lock rules', () => {
  it('is off by default and never locks', () => {
    let s = initialLock();
    expect(s.locked).toBe(false);
    s = lockReducer(s, { type: 'background', at: 0 });
    s = lockReducer(s, { type: 'foreground', at: 10 * 60_000 });
    expect(s.locked).toBe(false);
  });

  it('locks at start and after the timeout in the background, not before', () => {
    let s = lockReducer(initialLock(), { type: 'start', settings: on });
    expect(s.locked).toBe(true);
    s = lockReducer(s, { type: 'unlocked' });
    s = lockReducer(s, { type: 'background', at: 1000 });
    s = lockReducer(s, { type: 'foreground', at: 1000 + 59_999 });
    expect(s.locked).toBe(false);
    s = lockReducer(s, { type: 'background', at: 100_000 });
    s = lockReducer(s, { type: 'foreground', at: 160_000 });
    expect(s.locked).toBe(true);
  });

  it('"immediately" locks on any return from the background', () => {
    let s = lockReducer(initialLock(), { type: 'start', settings: { enabled: true, timeoutMs: 0 } });
    s = lockReducer(s, { type: 'unlocked' });
    s = lockReducer(s, { type: 'background', at: 5 });
    s = lockReducer(s, { type: 'foreground', at: 5 });
    expect(s.locked).toBe(true);
  });

  it('turning it on does not lock mid-session; turning it off unlocks', () => {
    let s = initialLock(DEFAULT_LOCK);
    s = lockReducer(s, { type: 'settings', settings: on });
    expect(s.locked).toBe(false);
    s = lockReducer(lockReducer(s, { type: 'background', at: 0 }), { type: 'foreground', at: 61_000 });
    expect(s.locked).toBe(true);
    s = lockReducer(s, { type: 'settings', settings: DEFAULT_LOCK });
    expect(s.locked).toBe(false);
  });

  it('accepts only the offered timeouts', () => {
    expect(lockSettingsSchema.safeParse({ enabled: true, timeoutMs: 300_000 }).success).toBe(true);
    expect(lockSettingsSchema.safeParse({ enabled: true, timeoutMs: 1 }).success).toBe(false);
    expect(lockSettingsSchema.safeParse({ enabled: true, timeoutMs: 0, extra: 1 }).success).toBe(false);
  });
});
