# applock module (P2b)

App lock with Face ID, fingerprint or the phone's PIN (plan F8; plan §17 "lock on background after a set
time, app switcher snapshot blurred"). Public interface: `src/modules/applock/index.ts`.

- **Rules** (`lockMachine.ts`, pure, tested): off by default; can be turned on only when the phone has a
  screen lock, and only after a successful unlock. Locks at start and when the app returns after 0, 1, 5 or
  15 minutes away (default 1 minute). Turning it on never locks mid-session; turning it off unlocks.
- **LockGate**: at a cold start nothing of the app is mounted until the first unlock (deep links wait).
  After that the app stays mounted under a re-lock (navigation survives), hidden from screen readers and
  covered by an opaque lock screen. While the app is inactive (app switcher), an opaque cover is shown.
- **Privacy**: while the lock is on, Android sets FLAG_SECURE (no screenshots, blank in Recent apps) and iOS
  blurs the app-switcher snapshot (expo-screen-capture).
- Settings live in the store's kv (`applock` / `settings`), on this phone only; Delete all data resets them.
- **It is a screen gate, not encryption** (P2b-S8). Database encryption stays the P7 revisit (P1-S6).
- Expo Go on iPhone has no Face ID; the passcode is used. Real-device behaviour is **UNVERIFIED**.
