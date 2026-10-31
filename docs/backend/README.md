# Backend (Firebase) — P2a

The server side of P2 ("Accounts and sync"), built early while P0 runs in another thread. **Emulator only** (project `demo-studynotes`): no real Firebase project, no deploys, no billing.

## What's here

```
firebase/
  firebase.json, .firebaserc        emulator config (auth 9099, firestore 8080, storage 9199, UI 4000)
  firestore.rules                   deny-by-default rules, top-level collections, owner checks
  storage.rules                     users/{uid}/{audio|images|ink|attachments}, asset-doc cross-check
  firestore.indexes.json            owner + updated indexes for incremental sync
  src/schemas/                      zod schema per cloud doc (SDK-free) + limits.ts (all numbers)
  src/deletion/                     in-app account deletion (Firebase JS SDK)
  scripts/admin-delete-user.ts      operator tool for web deletion requests (Firebase Admin, ADC)
  tests/                            unit, rules, agreement, deletion and admin tests
docs/backend/
  README.md                this page
  DATA_MODEL.md            collections, fields, lifecycle, sync contract (§D)
  LIMITS.md                every cap and its derivation (§L)
  ACCOUNT_DELETION.md      store requirements, in-app flow, web flow (§A)
  APP_CHECK_AND_BUDGET.md  free vs paid, App Check, budgets, real-project checklist
  SECURITY_REVIEW.md       threat model, findings by severity, gate evidence (§S)
  TESTING_BACKEND.md       Windows step-by-step test guide (P2a addendum to TESTING_ON_DEVICE)
  MERGE_NOTES.md           what to add to the shared docs; integration contract for P0/P1/P2
  PHASE_REPORT_P2a.md      phase report with the zip checksum
```

## Commands (run inside `firebase/`)

| Command | What it does |
|---|---|
| `npm ci` | install the exact pinned versions |
| `npm test` | start the emulators, run all tests, stop them |
| `npm run test:unit` | schema tests only (no Java) |
| `npm run emulators` | start the emulators + UI at http://127.0.0.1:4000 |
| `npm run typecheck` / `npm run lint` / `npm run audit` | phase gate checks |

Needs Node 24, npm 11 and Java 21+. See TESTING_BACKEND.md.

## Public interface (rule 2)

- `firebase/src/index.ts` → schemas, limits, `utf16String`, `utf8ByteLength` (no SDK imports, safe anywhere).
- `firebase/src/deletion/index.ts` → `deleteAccount`, `ReauthRequiredError`, `NotSignedInError` (needs the Firebase JS SDK).

Don't import from deeper paths.

## How it's built (short)

- **Rules mirror schemas.** The numbers live in `limits.ts`, the rules copy them, and a generated test checks every field boundary on both sides.
- **Deny by default.** Every collection has explicit get, list, create, update and delete rules. Everything else is denied.
- **Sync-safe lifecycle.** Server timestamps, `rev` = old + 1 (conflict detection), tombstones, append-only review logs.
- **Deletion lock.** `users/{uid}.deletionRequestedAt` blocks all writes from every device while the account is deleted.
