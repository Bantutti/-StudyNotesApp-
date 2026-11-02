# sync module (P2b)

Local SQLite <-> Firestore. Public interface: `src/modules/sync/index.ts`. Status: M1 to M3 built (engine, fake cloud, asset pass, Firestore and Storage adapters, emulator e2e suite). Screens and auth wiring come in later milestones. This page is completed at the P2b gate.

## Pieces

| File | Role |
|---|---|
| `ports.ts` | `RemoteBackend` (cloud) and `LocalReplica` (= `store.sync`) interfaces |
| `mapping.ts` | local row <-> cloud doc (`toCloudDoc`, `fromCloudDoc`), `planWrite`, `eraseRow` |
| `validate.ts` | P2a zod check on every upload and every download |
| `push.ts` | outbox -> cloud: profile first, prepare, batch, split, classify |
| `pull.ts` | cloud -> device: per collection, exact cursor, 60 s overlap |
| `resolve.ts` | stale writes: resolver tables vs automatic rules |
| `conflicts.ts` | Keep mine / Keep other / Keep both |
| `tombstone.ts` | erase deleted content locally once the cloud has the tombstone |
| `engine.ts` | single-flight `syncNow`, status, note-change events |
| `assets.ts` | the asset pass: doc then file, on-demand downloads, `registerAssetMerger` |
| `fakeRemote.ts` | in-memory cloud with the same rules as `firebase/firestore.rules` and `storage.rules` |

## Change tracking

SQLite triggers (store migration 2) add `(table, id)` to `syncOutbox` on every local insert or update, and bump `seq` on later edits. Rows written by a pull are not queued (the `syncState.applying` flag). There is no delete trigger, so removing data from the phone never deletes it in the cloud.

## Push

1. Read `users/{uid}`: missing after we once had it, or `deletionRequestedAt` set, means the account is gone (sync stops, local notes stay).
2. Prepare each item: a tombstone waits out the 8 s undo window and is erased; a note gets `ensureBlockIds` (saved locally first); the exact resulting doc is checked with P2a's schema, otherwise quarantined.
3. The profile is committed alone, first (the rules read the state before a batch). Then batches of 200.
4. A refused batch is split in halves down to the single refused write. That write is classified by reading the server copy: lost ack (our own write landed), stale (conflict or automatic rule), vanished (re-create), or invalid payload (quarantine).
5. Updates never resend `id`, `owner` or `created`: the stored `created` has microseconds, the local copy has milliseconds.

## Pull

Per collection: `owner == uid`, `updated` (review logs: `created`) `>=` cursor minus 60 s, ordered by time then doc id, paged. Cursors keep seconds and nanoseconds exactly. A doc is applied only if its rev is newer and the row has no queued local edit (checked in the same transaction); otherwise it is our own upload or a stale-write case.

## Conflicts (decisions Q4, Q5)

Notes, cards and recordings go to the resolver; the local version stays on screen and its upload pauses. Other tables resolve automatically: a delete beats an edit, otherwise the last push wins. Before any resolver choice on a note, both versions are saved in History ("Before sync merge").

## Assets (files) and merge hooks

P2a requires the asset doc (exact `size` and `cloudPath`) BEFORE the file upload. So the normal push skips the doc of any asset whose local file changed, and the asset pass (after push and pull) handles it: for each asset with a local file it compares the file's hash and the doc rev with the last synced version (`syncFiles` table):

| Local file | Cloud doc | Action |
|---|---|---|
| unchanged | newer | download and replace (only when the Storage file's size matches the doc) |
| changed | same | push the doc, then upload the bytes |
| changed | newer | with a merger for the type: download, `merger(local, remote)`, write locally, push the doc, upload. Without one: ours on top (last push wins) |

A stale asset-doc write takes the server's doc (resolveStale) and the pass then sees "both changed", so the merger runs for a stale upload too. Lost-ack detection is off for assets (two different files of the same size have the same doc).

**For P4b:** `registerAssetMerger('ink', merger)` at start-up (`merger(localBytes, remoteBytes) => mergedBytes`, pure and deterministic). Files of assets made on another device are downloaded on demand: `engine.ensureLocalFile(assetId)` returns a local path. Deleted assets: the Storage file is removed, then the erased tombstone syncs.

## Scheduling (decision Q3)

`createSyncScheduler` (scheduler.ts): sync on start and whenever the app comes to the foreground, then every 2 minutes while it stays open; at most one sync per 30 s while a note is being edited; at once when a note is left or the app goes to the background. When a note is opened, `refreshOne` re-reads just that note (1 read), which cuts conflicts. Free-tier cost: one pull is at least 10 reads, so about 2,400 reads per person per 8 open hours (limit 50,000 a day).

## In the app (composition)

`src/composition/syncController.ts` gives screens one view model: `off` (no Firebase config in this build), `signedOut`, `unverified`, `otherAccount` (phone bound to another account, Q7), `readyToTurnOn` (with the upload counts for the confirm screen), `on` (engine status) and `accountGone`. `turnOn({ onProgress })` binds the database, turns sync on and runs the first sync with progress. `signOut()` uploads the last edits, then stops sync and keeps notes and the binding. When the account was deleted on another device, the phone signs out and its notes become guest notes again (`store.sync.resetToGuest`). `SyncBridge` re-attaches the controller when the store reopens and passes app foreground/background to the scheduler. `cloudRuntime.ts` builds Firebase only when `EXPO_PUBLIC_FIREBASE_*` is valid; otherwise `services.cloud` is null and the app is local-only.

## Tests

- `store/__tests__/sync.test.ts`: triggers, applying pulled rows, bookkeeping, conflicts, binding, resets.
- `sync/__tests__/engine.test.ts`: two simulated devices on the fake cloud.
- `sync/__tests__/convergence.test.ts`: seeded random runs (2 and 3 devices). `SYNC_SEEDS=300 npx jest convergence` runs 300 seeds.
- `sync/__tests__/assets.test.ts`: the asset pass with a fake union merger (pull path and stale-upload path), Storage rule mirror.
- `sync/__e2e__/sync.e2e.test.ts`: two devices on the REAL Firebase JS SDK and rules (emulators). Run `npm run test:sync-e2e` (needs `cd firebase && npm ci` once and Java 21+). Not part of `npm test`.
- `composition/__tests__/syncController.test.ts` and `composition/__e2e__/turnOn.e2e.test.ts`: plan Flow 8 (guest notes, sign-up, verification gate, Turn on sync with counts and progress, a second phone signing in).
