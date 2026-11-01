# MERGE_NOTES: P2a → shared docs and app code

P2a owns only `firebase/` and `docs/backend/`. It did **not** edit README, ARCHITECTURE, SECURITY, CHANGELOG or TESTING_ON_DEVICE (they belong to the P0 thread). Below is exactly what to add when merging, and the contract the app's sync module (P2 app side) must follow.

---

## 1. Add to `docs/README.md`

Under "How to test", add:

> **Backend rules (P2a).** The Firebase backend lives in `firebase/` as its own npm project (own `package.json` and lockfile). It needs Java 21+. Run `cd firebase && npm ci && npm test`. Details: `docs/backend/README.md` and `docs/backend/TESTING_BACKEND.md`.

## 2. Add to `docs/ARCHITECTURE.md`

New section **"Backend (Firebase)"**:

- Firestore uses **top-level collections** (`users, subjects, folders, notes, cards, reviewLogs, recordings, assets, stylePacks, templates`), each doc with `owner`. Storage uses `users/{uid}/{audio|images|ink|attachments}/{assetId}.{ext}`.
- The note document, recording segments and pack/template definitions are **capped JSON strings**. Reason: Firestore's 20-level nesting limit, and the fact that rules can't measure maps.
- Lifecycle on every synced doc: `schemaVersion, created/updated (server time), rev (old + 1), deleted (tombstone)`. Review logs are create-only and merged by union.
- Account deletion is client-driven (`firebase/src/deletion`), with a rules-level "deletion in progress" lock.
- `firebase/src` (schemas) is SDK-free and can be imported by app modules through its index only. `firebase/src/deletion` needs the Firebase JS SDK.
- Link: `docs/backend/DATA_MODEL.md`.

## 3. Add to `docs/SECURITY.md`

- **Backend rules summary:** deny by default; verified email; `owner == uid` everywhere; queries need `where owner == uid` + `limit ≤ 500`; exact key sets and caps; server timestamps; `rev` conflict check; append-only review logs; Storage content-type and size caps and an asset-doc cross-check; no writes during account deletion.
- **Findings P2a:** copy the table from `docs/backend/SECURITY_REVIEW.md §S.4` (F-1 High fixed, F-2 Medium fixed, F-3 App Check open, F-5 dev-only moderates accepted).
- **Threat model additions:** §S.1 of the same file.
- **Known gaps:** rules can't validate inside JSON strings or enforce rate limits; zod on load is mandatory (§S.3).

## 4. Add to `docs/CHANGELOG.md`

```
## P2a — Backend (Nov 2026)
- Added firebase/ (own package.json + lockfile): emulator config for demo-studynotes, firestore.rules,
  storage.rules, firestore.indexes.json.
- Added zod schemas for every cloud document (field names from Plan v0.2 §12), with UTF-16-accurate
  string caps that match the rules.
- Added 586 emulator tests: access, lifecycle, review logs, storage, limits probes, 491 generated
  schema/rules agreement cases, account deletion end to end, admin deletion script.
- Added in-app account deletion module (resumable, no Cloud Functions) and the admin script for
  Google Play web deletion requests.
- Docs: docs/backend/* (data model, limits, deletion, App Check and budget plan, security review,
  Windows test guide).
```

## 5. Add to `docs/TESTING_ON_DEVICE.md`

- **Section 1 (Prerequisites):** add "Java JDK 21+, free: `winget install EclipseAdoptium.Temurin.21.JDK`; only needed to run backend tests."
- **Section 6 (Safe test backend):** replace or extend with: "Use the local Firebase emulators (project `demo-studynotes`, no account needed): `cd firebase && npm run emulators`, UI at http://127.0.0.1:4000. To connect a **phone** to the emulators (P2 app side), the emulators must listen on your PC's Wi-Fi address instead of 127.0.0.1. Only do this on a private home Wi-Fi, allow Java through Windows Firewall for **Private** networks only, and never on public Wi-Fi." The P2 app side should write these steps once the sync module exists.
- **Section 8 (Phase test checklist):** add the P2a table from `TESTING_BACKEND.md §5` (22 items, including "another user's note is not readable" and "invalid input is rejected").
- **Section 9 (Troubleshooting):** add the rows from `TESTING_BACKEND.md §6` (Java 21, execution policy, ports).
- The zip root's `TESTING_ON_DEVICE.md` for P2a is the backend addendum (`TESTING_BACKEND.md`), as Rey approved.

## 6. Contract for app code (P0 types, P1 editor, P2 sync module)

### 6.1 Field names
P2a used the plan's names (DATA_MODEL §D.2). **P0's types were not visible to this thread.** If they differ, choose one side and update the other in the same PR: the rules, `collections.ts` and the fixtures in `tests/helpers/fixtures.ts`. Then run `npm test`; the agreement test will point out anything you missed.

### 6.2 String lengths: important
**zod 4.6.7's `z.string().max(n)` counts code points; Firestore rules count UTF-16 units.** For any field that syncs, use `utf16String(min, max)` from `firebase/src` (or reuse the P2a schemas). Otherwise strings with emoji pass the app's checks and then fail at sync.

### 6.3 Root `package.json`: same High advisory
If the root lockfile has `@grpc/grpc-js` < 1.13.6 (pulled in by `firebase` 13.x), `npm audit` reports High. Add to the root `package.json`:
```json
"overrides": { "@grpc/grpc-js": "1.14.7" }
```
(React Native's Firestore uses WebChannel, not grpc-js, so this mostly affects Node tests. It still keeps the audit clean.)

### 6.4 Ids
Generate entity ids with **at least 80 random bits**, 16 to 64 characters of `[A-Za-z0-9_-]` (UUID v4 or ULID both work). Block ids: 1 to 64 characters of the same alphabet.

### 6.5 Sync module rules (P2 app side)
1. Create `users/{uid}` (rev 1, `deletionRequestedAt: null`, `settings` as a JSON string) **before** uploading anything.
2. Creates: `created` and `updated` = `serverTimestamp()`, `rev: 1`, `deleted: false`, `owner: uid`, `id` = doc id, `schemaVersion: 1`.
3. Updates: `updated` = `serverTimestamp()`, `rev: lastSeenRev + 1`. A `permission-denied` on an update whose payload passes zod = **conflict**: fetch the server copy and run the resolver.
4. Delete = set `deleted: true` (normal update). Purge tombstones later with a hard delete if wanted.
5. Pull incrementally: `where('owner','==',uid), where('updated','>',lastSync), orderBy('updated'), limit(≤ 500)`, paging with `startAfter`. The indexes are in `firestore.indexes.json`.
6. **Validate every downloaded doc with the zod schema** (including the JSON strings). Quarantine invalid docs and never render them (SECURITY_REVIEW §S.3).
7. Review logs: create-only, deterministic ids; ignore "already exists" denials (union merge).
8. Assets: write the asset doc (`size` = exact bytes, `cloudPath`) **then** upload. Don't send custom metadata. Upload ink on close, not per stroke (5K free uploads per month).
9. Never log note content, titles, emails or tokens.

### 6.6 Account deletion
Use `deleteAccount({ auth, firestore, storage })` from `firebase/src/deletion`. UI requirements: ACCOUNT_DELETION §A.2.1. Google Play also needs the web request page (§A.4) before release.

## 7. Decisions still waiting for Rey (from P2a)

1. **Asset types `ink` and `pdf`** (added beyond the plan's audio, image, sticker). Keep them? (LIMITS §L.8.1)
2. **Long recordings:** the audio file cap is 64 MiB (about 2 h 19 min at 64 kbps) but `duration` allows 6 h. Options: raise the cap to 128 MiB, use 32 kbps, or allow several assets per recording in P4. (LIMITS §L.8)
3. Nullable choices where the plan was silent: `folders.subject`, `notes.subject`/`folder`, `cards.note`/`sourceBlockId` (for manual cards) are nullable; `recordings.note` is required.
4. App Check approach for P2's app side: JS SDK now and App Check later, or React Native Firebase from the start (APP_CHECK_AND_BUDGET §3).

## 8. Repo hygiene
- `firebase/` is a **separate npm project**. Don't add it to root workspaces (that would merge lockfiles). CI: `cd firebase && npm ci && npm test` with Java 21.
- The root `.gitignore` should already ignore `/exports`. `firebase/.gitignore` ignores node_modules, debug logs, `.env*` and service-account JSON files.
