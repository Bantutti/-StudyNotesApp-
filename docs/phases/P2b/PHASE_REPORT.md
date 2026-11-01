# Phase report: P2b sign-in and sync (app side)

| | |
|---|---|
| Phase | P2b, accounts and sync, app side (Track A, Developer worker). Plan approved by the Lead for Rey (Q1 to Q14 all option A), Nov 1, 2026 |
| Date | 2026-11-01 (Asia/Manila) |
| Revision | **r2**: `main` 33712d8 merged in (C1 PR #4, P3b PR #7, lint fix PR #11; conflicts resolved in `composition/index.ts`, `_layout.tsx`, `me.tsx`, `note/[id].tsx`, `services.ts` and the shared docs). Clean PR from `main`: branch `phase/p2b-sync-r2`. r1 (SHA-256 32223e56…395b) stays in Drive for comparison |
| Backend | **Local Firebase emulators only** (project `demo-studynotes`). No real Firebase project, no deploys, nothing published |
| Zip | `{{ZIP_NAME}}` ({{ZIP_FILES}} files, {{ZIP_BYTES}} bytes) |
| SHA-256 | `{{ZIP_SHA256}}` |
| Code | GitHub `Bantutti/-StudyNotesApp-`, branch `phase/p2b-sync-r2` (from `main` 33712d8, mergeable PR) and `phase/p2b-sync` (PR #6, same tree) |

> The copy of this report **inside** the zip shows the placeholders above (a zip cannot contain its own
> checksum). The real values are in `exports/<zip>.sha256` and in the copy uploaded next to the zip
> (`PHASE_REPORT-P2b.md`).

## 1. What was built

| Area | Built |
|---|---|
| Change tracking | Store migration 2: SQLite triggers queue every local insert/update in `syncOutbox` (nothing for deletes, so removing data from the phone never deletes cloud data); pulled rows are not re-queued; existing guest rows are queued once |
| Sync engine | Push: profile first (alone), ensureBlockIds saved locally before upload, the exact doc checked with P2a's zod, batches of 200 split in halves on refusal, refused writes classified by the server copy (conflict, lost ack, vanished, invalid). Updates never resend `created` (server microseconds). Pull: per collection, exact (seconds, nanos, doc id) cursor with a 60 s overlap, zod + app schema on every doc, quarantine. Single flight |
| Conflicts | Notes, cards, recordings go to the resolver (Keep mine / Keep other / Keep both; deleted-elsewhere variants); others resolve automatically (delete beats edit, else last push wins); both versions saved in History first |
| Tombstones | Uploaded only after P1's 8 s undo window (the row is untouched meanwhile, so Undo keeps working), content erased in the cloud and locally; review logs merged by union |
| Files | Asset pass: doc first (exact size and path), then bytes; downloads on demand; **`registerAssetMerger(type, merger)`** for P4b (merge on a stale upload and on a pull with unsynced local changes) |
| Auth | Email sign-up, verification gate, sign-in, reset (no account enumeration), re-sign-in; Google and Apple Firebase half (hidden; scopes pinned to `openid email` / email, tested); name/photo scrub; session in SecureStore; one account per phone |
| App flow | Sync controller (one view model), Turn on sync with exact counts and masked email, progress, auto-restart, sign-out keeps notes, "account deleted on another device" -> guest notes; scheduler (foreground + 2 min, 30 s while typing, on leave/background, re-read on open) |
| Screens | Me (account and sync, app lock, privacy, terms, deletion page), sign-in, sign-up, verify, reset, Turn on sync, Needs attention, Conflict resolver (tabs on phones, side by side on tablets), Delete account, App lock settings, legal pages; sync chip in the note bar; Home banner |
| Account deletion | Re-sign-in, Apple token revoke (failure doesn't block; Apple ID hint), stop sync, P2a `deleteAccount` with step/count progress (reauth -> retry), local notes kept as guest notes, "Delete local data too" |
| App lock | Face ID / fingerprint / phone PIN, 0/1/5/15 min, nothing mounted before the first unlock, cover when inactive, FLAG_SECURE (Android) / app-switcher blur (iOS) |
| Legal pages | C1's `web/app-docs/` privacy, terms and delete-account, bundled from `phase/c1-compliance` @ e78a01a, blob SHAs pinned, `npm run check:legal` |
| Device testing | `npm run emulators:lan`, `npm run emu:verify`, `.env.example`, EAS `emulator` profile + config plugin (cleartext to one private LAN IP only) |

New modules: `sync`, `cloud`, `auth`, `applock`, `legal`. Changed: `store` (migration 2, `store/sync.ts`), `composition` (new files; `services.ts` one field + one adapter), screens.
Shared files touched (listed in the PR): `package.json`, lockfile, `jest.config.js`, `app.json` (plugin), `eas.json` (profile), `.gitignore`, `.env.example`, `services.ts`, `_layout.tsx`, `(tabs)/me.tsx`, `(tabs)/home.tsx`, `note/[id].tsx`.

## 2. How to run it

Local-only (as P1): `npm ci`, `npm run start:go`. With sync (emulators on your PC, private Wi-Fi only):
TESTING_ON_DEVICE.md section 6b: put the two `EXPO_PUBLIC_FIREBASE_*` lines in `.env`, `cd firebase && npm ci`
(once, Java 21), `npm run emulators:lan`, `npm run start:go -- --clear`, Me > Turn on sync, and
`npm run emu:verify -- <email>` for the verification link.

## 3. Phase gate results

| Check | Result |
|---|---|
| `npm run verify` (after merging main 33712d8; editor page, legal pages (`web/app-docs/` on main equals the pinned e78a01a copies), typecheck, lint, unit tests, secret scan, prod audit) | **Pass**: 774 passed, 10 skipped (opt-in live AI tests), with P3b's suites from `main`; secretlint clean; prod audit **0** |
| Random convergence (2 and 3 devices) | 300 seeds pass (`SYNC_SEEDS=300 npx jest convergence`); 12 run in `npm test` |
| `npm run test:sync-e2e` (real Firebase JS SDK 13.1.0 + P2a rules, emulators) | **20/20**: 10 two-device sync, 8 auth, Flow 8 (guest -> sign-up -> verify -> Turn on sync -> second phone), **account deletion leaves nothing** (0 docs, 0 Storage files, 0 Auth users; second phone stops and uploads nothing) |
| P2a rules (`cd firebase && npm test`) | **601/601** (rules unchanged) |
| `npm run bundle:check` | Android and iOS Hermes bundles build (about 10 MB each), with P3b's screens |
| `npm run audit:all` | 7 **low**, dev-only (jest `deepmerge` chain), the same on `main` before P2b; accepted |
| Toolchain | Temurin JDK 21.0.13+9 (Adoptium SHA-256 verified); emulator jars match the SHA-256 pinned in firebase-tools 15.34.2 |
| Security review | SECURITY.md section 4d: **no open High**; P2b-S1 (App Check) Medium open and tracked |

## 4. Clean-setup verification

A fresh clone of the branch, then exactly the commands in README and TESTING_ON_DEVICE: `npm ci` (20 s),
`npm run verify` (pass), `cd firebase && npm ci && npm test` (601/601), `npm run test:sync-e2e` (20/20),
`npm run bundle:check` (both bundles), `npm run emulators:lan` (Auth, Firestore and Storage listen on all
interfaces, the UI on 127.0.0.1 only; the generated config is removed on exit). Phone steps (section 6b and
the P2b checklist) need Rey's devices: **UNVERIFIED**.

## 5. Security findings (summary; details in SECURITY.md section 4d)

| Severity | Count | Notes |
|---|---|---|
| High | 0 | |
| Medium | 4 | S1 App Check **open** (needs a development build); S2 wrong-account upload, S3 tampered cloud docs, S4 writes during deletion: **fixed** |
| Low | 7 | S5 SDK logs, S6 tokens at rest, S9 cleartext: fixed; S7 provider name record: mitigated; S8 app lock is not encryption, S10 untrusted file bytes, S11 open-note race: accepted/mitigated |
| Info | 1 | S12 enumeration protection and password policy on a real project |

## 6. Export contents check

The export script refuses `.env`, keystores, service-account files and anything shaped like a key; the
listing (`exports/<zip>.contents.txt`) was reviewed: source, docs, configs, lockfiles, `firebase/` (rules,
tests, scripts; no `node_modules`), the generated editor page and legal pages; no secrets, no build output.
The 6 PNG icons are included in the zip but not in git (GitHub tools push text only).

## 7. Known limits

- **UNVERIFIED on real phones**: everything in the P2b checklist (Firebase SDK start-up on Hermes in Expo Go
  and the APK, SecureStore session, app lock prompts, FLAG_SECURE and app-switcher blur).
- Google and Apple sign-in: Firebase half only (hidden); native modules need a real project and a
  development build; Apple also the paid Apple Developer account (Rey's later decision).
- No network-state listener: after a lost connection, sync resumes within 2 minutes or when the app comes to
  the foreground.
- Open-note race (P2b-S11) accepted for now.
- Storage on a real project needs the Blaze plan (decision pending); everything here runs on the emulator.
- The PR is pushed with the GitHub file tools, which create commits without a merge parent: main's files are
  byte-identical on the branch, so the PR diff shows only P2b's changes.

## 8. What is next

Merge (Lead). Then P4 (voice: recordings use the asset pass), P4b (ink: `registerAssetMerger('ink', …)`),
P4c (review logs already sync by union; card scheduling rebuilt from logs). Before a real Firebase project:
App Check (development build), Email Enumeration Protection, budget alert, Storage on Blaze.
