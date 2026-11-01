/**
 * App lock rules (plan F8 "App lock with Face ID, fingerprint or device
 * PIN"; plan §17 "lock on background after a set time, app switcher
 * snapshot blurred"). Pure: time and events come in, a state goes out.
 *
 * - Off by default. It can be turned on only when the phone has a screen
 *   lock (otherwise there is nothing to unlock with).
 * - Locked at start, and when the app comes back after being in the
 *   background for at least `timeoutMs` (0 = immediately).
 * - It's a screen gate, not encryption (docs/modules/applock.md).
 */
import * as z from 'zod';

export const LOCK_TIMEOUTS_MS = [0, 60_000, 300_000, 900_000] as const;
export type LockTimeout = (typeof LOCK_TIMEOUTS_MS)[number];

export const lockSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  timeoutMs: z.union(LOCK_TIMEOUTS_MS.map((v) => z.literal(v)) as unknown as [z.ZodLiteral<0>, z.ZodLiteral<60000>, z.ZodLiteral<300000>, z.ZodLiteral<900000>]),
});
export type LockSettings = z.infer<typeof lockSettingsSchema>;
export const DEFAULT_LOCK: LockSettings = { enabled: false, timeoutMs: 60_000 };

export interface LockState {
  settings: LockSettings;
  locked: boolean;
  backgroundedAt: number | null;
  /** Unlocked at least once since start (the app stays mounted under a re-lock). */
  everUnlocked: boolean;
}

export type LockEvent =
  | { type: 'start'; settings: LockSettings }
  | { type: 'background'; at: number }
  | { type: 'foreground'; at: number }
  | { type: 'unlocked' }
  | { type: 'settings'; settings: LockSettings };

export function initialLock(settings: LockSettings = DEFAULT_LOCK): LockState {
  return { settings, locked: settings.enabled, backgroundedAt: null, everUnlocked: !settings.enabled };
}

export function lockReducer(s: LockState, e: LockEvent): LockState {
  switch (e.type) {
    case 'start':
      return initialLock(e.settings);
    case 'background':
      return { ...s, backgroundedAt: s.backgroundedAt ?? e.at };
    case 'foreground': {
      const away = s.backgroundedAt === null ? 0 : e.at - s.backgroundedAt;
      const lock = s.settings.enabled && s.backgroundedAt !== null && away >= s.settings.timeoutMs;
      return { ...s, locked: s.locked || lock, backgroundedAt: null };
    }
    case 'unlocked':
      return { ...s, locked: false, everUnlocked: true };
    case 'settings':
      // Turning the lock on doesn't lock the person out mid-session; turning it off unlocks.
      return { ...s, settings: e.settings, locked: e.settings.enabled ? s.locked : false, everUnlocked: s.everUnlocked || !e.settings.enabled };
  }
}
