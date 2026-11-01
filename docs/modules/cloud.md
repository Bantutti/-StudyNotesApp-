# cloud module (P2b)

The Firebase JS SDK behind small interfaces. Public interface: `src/modules/cloud/index.ts`.

| File | Role |
|---|---|
| `config.ts` | reads `EXPO_PUBLIC_FIREBASE_*` with zod. An emulator host is accepted only with a `demo-*` project id, and a `demo-*` project only with the emulators. Anything invalid turns cloud features off (the app stays local-only). |
| `firebaseApp.ts` | one Firebase app instance (Auth, Firestore with the memory cache, Storage), connected to the emulators when configured. Several named instances can coexist (two simulated devices in tests). |
| `firestoreRemote.ts` | the sync engine's `RemoteBackend`: server-only reads, atomic batches with a 20 s timeout, owner-scoped paged queries; errors reduced to codes |
| `storageBlobs.ts` | the asset pass's `BlobStorePort` (content type only, no custom metadata) |

Decision (Nov 1, 2026): P2b uses the local emulators only (project `demo-studynotes`). A real project is dropped in later by changing the `EXPO_PUBLIC_FIREBASE_*` variables.

**Metro** (`metro.config.js`): the app imports P2a's SDK-free schemas from `firebase/src`. Metro maps its `.js` import specifiers to `.ts` and hides `firebase/node_modules`, so the bundle holds one copy of zod and of the Firebase SDK (checked with a source map: Auth and Firestore use their React Native builds).

**UNVERIFIED on a device:** the Firebase SDK start-up in Expo Go and an APK (Hermes). It bundles and runs in Node tests; Rey's end-of-build device run checks it.
