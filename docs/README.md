# NotedPo (Study Notes App): developer README

## What it is

A study note-taking app for Android and iPhone built around one loop: **Capture, Shape, Review, Recall**.
Notes look like aesthetic handwritten study notes (style packs such as Pastel Highlight), and the app
adds voice notes with word-level timestamps, pen or finger drawing, spaced-repetition flashcards (FSRS)
and export to PDF, DOCX and print. It works with no account and no AI key; sign-in only turns on sync
(P2), and AI uses the student's own free provider key (P3).

## Current phase: P1, the core app

P1 is the real offline app (guest mode: no account, no AI key):

- **Onboarding:** Welcome cards, pick your look on the real sample page, first subject, Sample note.
- **Notes:** a TipTap editor with autosave, a keyboard toolbar, slash menu and block picker, typing
  shortcuts, study blocks (definition, callout, Q&A, quote, summary, two columns or Cornell, tables) and
  stable block ids.
- **Organising:** subjects with colours and exam dates, folders, Inbox, tags, sort, delete with Undo.
- **Shaping:** 7 templates, Beautify Lite (on the phone), two looks (Pastel Highlight, Clear Read with
  Atkinson Hyperlegible), the Style sheet.
- **History and search:** version history with Restore, full-text search that opens the note at the line.
- **Hidden developer menu** (Me > tap the version 7 times): the P0 spike lab and Typing diagnostics.

Also in the repo: the **P2a backend** (`firebase/`, Firestore and Storage rules with emulator tests) and the
**P3a AI engine** (`src/modules/ai`, no screens until P3b).

**P2b (sign-in and sync)** adds accounts and two-device sync against the **local Firebase emulators only**
(project `demo-studynotes`; no real Firebase project, nothing online), Turn on sync with counts, the
Conflict resolver, in-app account deletion, app lock and the in-app legal pages. Without the
`EXPO_PUBLIC_FIREBASE_*` lines in `.env` the app stays local-only. Phone setup: TESTING_ON_DEVICE.md 6b.

## App identity

| Item | Value | Where |
|---|---|---|
| Display name | **NotedPo** | `app.json` `expo.name` and `'app.name'` in `src/core/strings.ts` (every visible use reads it via `{app}`; a test keeps the two equal) |
| Android package | `io.github.bantutti.notedpo` | `app.json` `expo.android.package` |
| iOS bundle id | `io.github.bantutti.notedpo` | `app.json` `expo.ios.bundleIdentifier` |
| URL scheme | `notedpo` (`notedpo://`) | `app.json` `expo.scheme` |
| Expo slug | `notedpo` | `app.json` `expo.slug` (the EAS project name; no EAS project is linked yet) |

Name and app id **confirmed by Rey on Nov 1, 2026**. The Android id becomes **permanent at the first Google Play
upload** (a new id would mean a new store listing, and users would lose their local notes when moving), so do not
change it. `src/core/__tests__/appName.test.ts` fails if these values drift or a P0 placeholder comes back.

Internal names that are **not** app identifiers and stay as they are: the npm package name `study-notes-app`, the
on-device database file `studynotes.db` (renaming it would orphan existing test installs' notes), and the P2a
emulator project `demo-studynotes` (P2b picks the real Firebase project id).

## Requirements

- **Node.js 24 LTS** (the project refuses other majors: `engine-strict`). npm 11 comes with it.
- Git (optional but recommended).
- A phone with **Expo Go** (free): the whole P1 app runs in it, on Android and iPhone. An installable
  Android APK is one cloud build away (free Expo account, TESTING_ON_DEVICE.md section 4c). The P0
  90-minute background recording spike needs the free Android development build (section 4b).
- Java 21+ only to run the backend tests (`firebase/`).

## Setup

```bash
npm ci                      # exact versions from package-lock.json
copy .env.example .env      # Windows (macOS/Linux: cp .env.example .env). The app needs no secrets.
```

## Run

```bash
npm run start:go            # Expo Go: scan the QR code with your phone
npm run start:go:tunnel     # same, through a tunnel if your Wi-Fi blocks the phone
npm run start:dev           # for the Android development build (background recording)
```

## Test and check

```bash
npm run verify              # editor bundle up to date + typecheck + lint + unit tests + secret scan + prod audit
npm test                    # unit tests only (Jest, two projects: app and web)
npm run bundle:check        # builds real Android and iOS bundles (Hermes bytecode) into dist-check/
npm run audit:all           # full dependency audit including dev tools
```

**Backend rules (P2a).** The Firebase backend lives in `firebase/` as its own npm project (own
`package.json` and lockfile). It needs Java 21+. Run `cd firebase && npm ci && npm test`. Details:
`docs/backend/README.md` and `docs/backend/TESTING_BACKEND.md`.

**Sign-in and sync (P2b).** `npm test` runs the sync engine against an in-memory cloud with the same rules
(two-device and randomised convergence tests). The emulator end-to-end suite runs the real Firebase JS SDK
and P2a's rules with two simulated devices: `cd firebase && npm ci` once, then `npm run test:sync-e2e`
(Java 21+). `npm run check:legal` checks the bundled legal pages against their pinned C1 commit.

**AI engine (P3a).** `npm test` runs its unit tests; the opt-in live check with your own keys is described
in `docs/modules/ai.md`.

If you change anything in `editor-web/`, run `npm run build:editor` (it regenerates
`src/modules/editor/generated/editorHtml.ts` and its CSP hash). `npm run verify` fails if you forget.

## Export a phase

```bash
npm run export:phase -- P1 core-app
```

Writes `exports/StudyNotesApp-P1-core-app-<YYYYMMDD>.zip`, a `.sha256` file, a contents listing and
`exports/PHASE_REPORT-P1.md` with the checksum filled in. The script refuses to include `.env`,
keystores, service-account files and anything that looks like a key.

## Folder map

```
src/app/            routes (Expo Router): tabs (home, subjects, me), onboarding, note editor, subject,
                    folder, inbox, search, history, version, style, templates, forms; dev/ (P0 spikes, typing)
src/screens/        shared screen pieces: NoteCard, NoteBrowser, EditorToolbar, editor sheets
src/composition/    composition root (dependency injection), app data lifecycle, use cases, autosave
src/core/           shared building blocks: logger, validation, document model v2, limits, strings, UI kit
src/modules/        feature modules, each with a public index.ts and its own tests
  ai/               AI engine (P3a): providers, actions, proposals, usage meter, key vault
  beautify/         Beautify Lite (on-device rules)
  editor/           TipTap WebView host, bridge protocol, hardening, links, previews, action hook
  export/           PDF / DOCX / print exporters behind adapters
  ink/              Skia drawing surface, palm rejection, smoothness stats
  review/           FSRS scheduler, append-only review logs, on-device self-test
  store/            SQLite tables (mirror the cloud docs), migrations, search, versions, settings
  stylepacks/       13 validated style packs (2 offered in P1), pack -> CSS, bundled OFL fonts
  templates/        7 built-in note templates (validated data)
  voice/            recording presets and session monitor, Groq Whisper adapter, WER and drift maths
editor-web/         the code that runs INSIDE the editor WebView (bundled by esbuild)
firebase/           P2a backend: rules, schemas, emulator tests (separate npm project)
scripts/            build-editor, export-phase and their tests (plus the route-table test)
test/               test helpers (node:sqlite driver, native module mocks)
docs/               all documentation (backend/ for P2a, phases/ for each phase report)
```
