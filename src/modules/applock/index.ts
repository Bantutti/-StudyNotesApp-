/** applock: Face ID / fingerprint / device PIN gate for the app (P2b, plan F8). See docs/modules/applock.md. */
export { lockReducer, initialLock, lockSettingsSchema, DEFAULT_LOCK, LOCK_TIMEOUTS_MS, type LockSettings, type LockState, type LockEvent, type LockTimeout } from './lockMachine';
export { type DeviceAuthPort, type ScreenPrivacyPort } from './ports';
export { expoDeviceAuth, expoScreenPrivacy } from './expoAdapters';
export { LockGate, LOCK_NS, LOCK_KEY, lockKvSchema, type LockStorage } from './LockGate';
