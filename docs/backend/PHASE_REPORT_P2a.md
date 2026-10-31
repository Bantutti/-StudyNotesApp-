# PHASE REPORT — P2a: Backend (server side of P2, built early)

**Date:** 2026-11-01 · **Thread:** P2a backend (Dev Engineer) · **Status:** gate passed, waiting for Rey's sign-off
**Zip:** `StudyNotesApp-P2a-backend-20261101.zip` · **Drive:** `StudyNotesApp/P2a-backend`

## 1. What was built

| Part | Files | Notes |
|---|---|---|
| Emulator setup | `firebase/firebase.json`, `.firebaserc` | Project `demo-studynotes`; Auth 9099, Firestore 8080, Storage 9199, UI 4000 |
| Firestore rules | `firebase/firestore.rules` (432 lines, commented) | Top-level collections, deny by default, verified email, `owner == uid`, owner-filtered queries with `limit ≤ 500`, exact keys, types, caps, enums, server timestamps, `rev` conflict check, tombstones, append-only review logs, deletion lock |
| Storage rules | `firebase/storage.rules` | `users/{uid}/{audio,images,ink,attachments}`, content-type and size caps, no custom metadata, upload must match a Firestore asset doc, no uploads during deletion |
| Indexes | `firebase/firestore.indexes.json` | `owner + updated` (and `owner + created` for reviewLogs) for incremental sync |
| zod schemas | `firebase/src/schemas/*` | One per cloud doc, plan field names, all numbers in `limits.ts`; UTF-16-accurate string caps; JSON-string inner validators (document tree with block ids and audio anchors, segments, definitions, settings) |
| Account deletion | `firebase/src/deletion/*` | Resumable 5-step in-app deletion, no Cloud Functions |
| Admin deletion script | `firebase/scripts/admin-delete-user.ts` | For Google Play web requests; dry run by default; ADC only; emulator/production guard |
| Tests | `firebase/tests/**` | **586 tests in 9 files** (below) |
| Docs | `docs/backend/*` | README, DATA_MODEL, LIMITS, ACCOUNT_DELETION, APP_CHECK_AND_BUDGET, SECURITY_REVIEW, TESTING_BACKEND, MERGE_NOTES, this report |

### Test suite

| File | Tests | Proves |
|---|---|---|
| rules/agreement.test.ts | 491 | zod and the rules agree on every field boundary of all 10 doc types (generated mutations, including emoji/UTF-16 cases); 4 documented gap kinds asserted |
| rules/firestore.access.test.ts | 15 | signed-out, unverified and anonymous denied; Alice vs Bob; query shape; closed paths |
| rules/firestore.lifecycle.test.ts | 17 | server time, immutables, rev, tombstones, hard delete, deletion lock, 500-write batch |
| rules/firestore.reviewLogs.test.ts | 12 | create-only, no edits, no re-send, delete only via tombstoned card or account deletion |
| rules/storage.test.ts | 14 | owner-only, content types, caps, asset cross-check, deletion lock, list and delete |
| rules/limits-probe.test.ts | 6 | rules count UTF-16 units; a 600k-character document fits in one doc |
| deletion/deleteAccount.test.ts | 6 | everything deleted, Bob untouched, resume after a crash, never-synced and unverified users, reauth mapping |
| admin/admin-delete-user.test.ts | 5 | collection list matches the schemas, argument and environment guards, dry run vs confirm, real `node` CLI run |
| unit/schemas.test.ts | 20 | document tree rules, byte cap, segments, asset cross-fields, portable byte counter |

## 2. How to run it

See `TESTING_ON_DEVICE.md` at the zip root (the P2a backend addendum = `docs/backend/TESTING_BACKEND.md`). In short, on Windows with Node 24 and Java 21:

```powershell
cd C:\dev\StudyNotesApp-P2a\firebase
npm ci
npm test          # expect: Test Files 9 passed (9), Tests 586 passed (586)
npm run gate      # typecheck + lint + tests + audit
```

**Where it was actually run:** this sandbox (Linux, Node 24.22.1, npm 11.19.1, Temurin JDK 21.0.13, firebase-tools 15.34.2). It was **not** run on Windows here. The Windows guide uses the same npm scripts, but please follow it once and tell me if any step differs.

## 3. Phase gate (rule 5)

| Gate item | Result |
|---|---|
| Tests | 586 / 586 passed (`npm test`) |
| Lint, typecheck | clean (ESLint 10 strict type-checked; TypeScript 6.0.3 strict) |
| Backend rules tests | included above |
| Dependency audit | 0 critical, 0 high; 7 moderate inside firebase-tools (dev-only, accepted: SECURITY_REVIEW F-5) |
| Secret scan | gitleaks 8.30.1: no leaks found (source, docs and the final zip contents) |
| Security review | `docs/backend/SECURITY_REVIEW.md`: **no open High**. Fixed: F-1 High (grpc-js advisory via override), F-2 Medium (zod code points vs rules UTF-16). Open Medium: F-3 App Check (needs the real project and dev builds) |
| Docs | docs/backend complete; shared-doc additions listed in MERGE_NOTES (P2a doesn't own the shared docs) |
| TESTING guide followed on a clean setup | followed in the sandbox from a clean `npm ci`; **Windows run pending (Rey)** |

## 4. Security findings and fixes (summary)

- **F-1 High, fixed:** `@grpc/grpc-js` < 1.13.6 under the Firebase JS SDK. Overridden to 1.14.7. P0's root lockfile likely needs the same (MERGE_NOTES §6.3).
- **F-2 Medium, fixed:** zod 4.6.7 measures string length in code points, the rules in UTF-16 units, so emoji text could pass the app and fail at sync. Now `utf16String()` is used everywhere, with regression tests. **P0 and P1 must adopt it.**
- **F-3 Medium, open:** App Check isn't enforced (no real project yet; Expo Go can't run it).
- Lower items: SECURITY_REVIEW §S.4.

## 5. Known limits

- The rules can't validate inside JSON strings or every bookmark item, and can't rate-limit. zod on load is mandatory in the sync module.
- Storage needs Blaze. Under the Spark decision, files stay on the device until Rey chooses.
- Field names come from the plan, but P0's types weren't visible. Reconcile at merge (MERGE_NOTES §6.1).
- No GitHub push: the linked account (Bantutti) shows no repository yet, and P2a must never make the first push.
- Open decisions for Rey: asset types ink and pdf; long-recording cap; nullable choices; App Check approach (MERGE_NOTES §7).

## 6. What's next

1. Rey: run TESTING_BACKEND.md on Windows; answer the four open decisions.
2. When P0's repo is on GitHub `main`: open a `p2a-backend` branch with `firebase/` and `docs/backend/`, and a PR that applies MERGE_NOTES.
3. P2 app side (after P1): sign-in screens, the sync module following DATA_MODEL §D.3 and MERGE_NOTES §6.5, the deletion UI, and the App Check decision.

## 7. Zip checksum

| File | SHA-256 |
|---|---|
| `StudyNotesApp-P2a-backend-20261101.zip` (188,886 bytes, 47 entries) | `9428dad86c467569e1ceb770c7a0c37e71b5c12fe4d84c0b083ff013ed9bca27` |

Verify on Windows (PowerShell, in the folder with the zip):

```powershell
Get-FileHash .\StudyNotesApp-P2a-backend-20261101.zip -Algorithm SHA256
```

The `Hash` it prints must equal the value above (Windows prints it in upper case; compare letter by letter, ignoring case). Inside the zip, `MANIFEST.sha256` lists a SHA-256 for every file.

**Contents check (rule 5.5):** no node_modules, no build output, no .env files, no service-account or signing keys, no logs. Verified by a name scan of the zip listing, by gitleaks on the extracted zip ("no leaks found"), and by a clean-room run: extracted to an empty folder → `npm ci` → `npm run gate` → 586/586 passed.
