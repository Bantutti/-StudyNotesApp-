# auth module (P2b)

Sign-in for sync. Public interface: `src/modules/auth/index.ts`. Screens use `AuthService`; nothing outside `auth` and `cloud` imports Firebase Auth.

## States

`loading` -> `signedOut` | `unverified` (email not verified yet: the rules refuse every read and write, so sync can't run) | `ready` (verified). `checkVerified()` reloads the user and refreshes the ID token, because the rules read `email_verified` from the token.

## Methods (decision Q1)

| Method | Status in P2b | What a real build needs |
|---|---|---|
| Email: sign up, verify, sign in, reset, re-sign-in | **Built and tested** on the emulator (`src/modules/auth/__e2e__`) | Nothing (works in Expo Go) |
| Google | Firebase half built and tested with the emulator's fake ID tokens; button hidden (`methods().google === false`) | A real Firebase project and OAuth client (free) plus a native Google Sign-In module in a development build. **UNVERIFIED** |
| Apple | Firebase half built and tested (raw nonce to Firebase, SHA-256 nonce to Apple); button hidden | A real project, a native Apple module, and the **paid Apple Developer account (about $99/yr)**, which is Rey's later decision. **UNVERIFIED** |

Native token sources plug in through `GoogleTokenSource` / `AppleTokenSource` (`ports.ts`).

## Privacy rules

- **Scopes** (`scopes.ts`, pinned by `scopes.test.ts`): Google `openid email` only, never `profile`; Apple email only, never the full name. C1's store forms declare only the email address.
- After every sign-in, the top-level display name and photo are cleared (`updateProfile`). Known limit: Firebase keeps the provider's own record (`providerData`). With the scopes above, a real Google or Apple token carries no name, so nothing is stored there either; the emulator's fake tokens can carry one, which the e2e test shows.
- Emails, passwords and tokens are never logged; errors keep a reason code, never the server message.
- No account enumeration: a wrong password and an unknown email give the same message, and a password reset always "succeeds" for a valid address.
- Passwords: 8 to 128 characters (Firebase's own minimum is 6).

## Session storage (decision Q8)

`createSecureKeyValue(SecureStore)` gives Firebase's `getReactNativePersistence()` a Keychain/Keystore-backed store. Keys are hex-encoded (SecureStore allows `[A-Za-z0-9._-]`) and values are split into 1,800-character chunks (SecureStore's limit is about 2 KB). A torn write reads as signed out.

## One account per phone (decision Q7)

`bindAccount(store, uid)`: the first sign-in binds the local database; another account is refused until "Remove notes from this phone". Signing out stops sync and keeps the notes and the binding.
