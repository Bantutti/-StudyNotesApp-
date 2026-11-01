# Phase report: P1 core app

| | |
|---|---|
| Phase | P1, core app (Track A, Developer worker), plan approved by Rey Nov 1, 2026 |
| Date | 2026-11-01 (Asia/Manila) |
| Revision | **r2**: independent review fixes (M1–M4, L1–L6, Info). r1 stays in Drive for comparison. Follow-up after r2: Gaegu font fix (P1-S24), in GitHub only (no new zip asked) |
| Zip | `{{ZIP_NAME}}` ({{ZIP_FILES}} files, {{ZIP_BYTES}} bytes) |
| SHA-256 | `{{ZIP_SHA256}}` |
| Code | GitHub `Bantutti/-StudyNotesApp-`, branch `phase/p1-core-app`, PR #5 (includes P0, P3a and P2a from `main`) |

> The copy of this report **inside** the zip shows the placeholders above, because a zip cannot contain
> its own checksum. The real values are in `exports/<zip>.sha256` and in the copy uploaded next to the zip
> (`PHASE_REPORT-P1.md`).

## 1. What was built

The real offline app (guest mode: no account, no AI key), runnable in Expo Go on Android and iPhone and as
an Android APK. No publishing.

| Area | Built |
|---|---|
| Local data | SQLite tables that copy P2a's cloud docs field for field, migrations, FTS5 search (one row per block), versions, settings, 8 s undo then wipe, Delete all data |
| Document model v2 | Quote, summary, Q&A, two columns (even, Cornell), simple tables, `audioAnchor`, structure rules, cloud size caps, `attrs.blockId` |
| App shell | Tabs Home · Subjects · (+) · Me, light/dark, database start-up, developer menu (P0 spikes + Typing diagnostics) |
| Onboarding | Welcome, Pick your look (live sample page), first subject, Sample note, Skip anywhere |
| Organising | Home (continue, exam countdowns, recent, search), Subjects, folders, Inbox, sort, tags, move, delete + Undo |
| Editor | Live TipTap editor, autosave (1 s / 5 s / flush), keyboard toolbar with the P3b sparkle slot (fixed, live, empty without a `sparkle` action; render-tested with `test-renderer`), slash menu and block picker, shortcuts, block menu, Info, focus mode, search-to-line |
| Block ids | Stable through Enter, paste, turn-into, cut-move, duplicate, move, undo, Beautify, templates, restore, pack switch (tested) |
| Shaping | 7 templates, Beautify Lite, Style sheet, Pastel Highlight + Clear Read v2 (Atkinson Hyperlegible) |
| History | Versions before Beautify/AI/style/template/restore, every 10 minutes and on leaving; History, preview, Restore |
| Links | Open only in the OS browser after "Open link?" (Apple age-rating rule, C1) |
| P3b hook | `EditorAction` registry + `runEditorAction` (validate, version, save, exact Undo) |
| Follow-ups done | P3a: ErrorCode `cancelled`/`consent`. P2a: UTF-16 synced text, contract tests on |

Modules added: `store`, `templates`, `beautify`. Changed: `core`, `editor` (+ `editor-web`), `stylepacks`,
`composition`; `export` (shared file: render new blocks). Untouched: `ai` (except the 2-line error mapping the
Lead requested), `firebase/`, `docs/backend/`.

## 2. How to run it

```powershell
npm ci
copy .env.example .env
npm run start:go          # scan the QR code with Expo Go (Android or iPhone)
```

Android APK (no PC needed afterwards): `npx eas-cli@latest build --profile preview --platform android`
(free Expo account; TESTING_ON_DEVICE.md section 4c). Backend tests: `cd firebase; npm ci; npm test`
(Java 21). Full guide: `TESTING_ON_DEVICE.md` (also at the zip root), section 8 "P1" has 33 numbered checks.

## 3. Phase gate results

| Gate | Result |
|---|---|
| Unit tests | **476 passed**, 10 skipped (P3a opt-in live tests) in 51 suites (app + web). Includes 8 P2a contract tests, editor block-id/editor tests, store, search, templates, Beautify, autosave, versions, use cases, routes, and the r2 review tests (each fails on r1's code: 26 tests in 10 suites) |
| Type check (`tsc --noEmit`, strict) | Pass |
| Lint (`eslint . --max-warnings 0`, React Compiler rules, editor-web import rule) | Pass |
| Editor page integrity (`npm run check:editor`) | Pass: CSP hash matches the single inline script (586,948 bytes, `sha256-Gd2ejNmWyPcPayBzZh2wRYu86cDESqefeOxCU6IzUkE=`) |
| Production dependency audit | **0 vulnerabilities** |
| Full audit (incl. dev tools) | 7 low (deepmerge via Jest; dev-only, no fix): accepted, P0-S6 |
| Secret scan (secretlint + custom patterns) and export content scan | Clean |
| Real bundles (`expo export`, Hermes) | Android 8.1 MB, iOS 8.1 MB: both compile |
| Backend rules tests | Not re-run here (no Java in this sandbox); unchanged `firebase/` passed 601/601 at the P2a merge (Lead, Nov 1). P1's contract tests run P2a's schemas on every local table row and every P1 document |
| Security review | Done: no open High or Medium (section 5) |
| Docs | README, TESTING_ON_DEVICE (P1 checklist, APK, backend, AI, troubleshooting), ARCHITECTURE, SECURITY, CHANGELOG, module docs (core, editor, store, templates, beautify, stylepacks), this report; P2a and P3a merge notes folded in |

## 4. Clean-setup verification of TESTING_ON_DEVICE.md

Done on 2026-11-01 in a fresh Linux sandbox (Node 24.22.1, npm 11.19.1) from the exported zip, following
sections 1 and 2 exactly:

| Step | Result |
|---|---|
| Unzip to an empty folder; confirm no `.env` inside | Pass (`.env.example` only; `PHASE_REPORT.md` and `TESTING_ON_DEVICE.md` at the root) |
| `npm ci` | Pass in 17 s (install-script warnings as documented) |
| `copy .env.example .env` (Linux: `cp`) | Pass |
| `npm run verify` | Pass: editor page up to date, types, lint, **476/476 tests** (10 skipped), secret scan, prod audit 0 |
| `npm run bundle:check` | Pass: Android and iOS Hermes bundles (8.1 MB each) |
| `npm run start:go` (headless) | Pass: Metro running, manifest `runtimeVersion exposdk:58.0.0` (Expo Go SDK 58), app name "NotedPo", Android dev bundle served (14.3 MB, HTTP 200) |

Windows-specific parts (PowerShell `copy`, Windows Firewall prompt, `adb reverse`) and the EAS APK build
(needs your Expo account) could not be run here; they are written for you to follow.

**Not verifiable by me (needs your phones):** sections 3 to 5 and the on-device checklist in section 8
(Expo Go on Android and iPhone, the APK, typing with real keyboards, the timed first note). Android keyboard
behaviour is **unverified**: run Typing diagnostics (checklist step 24) and send the log.

## 5. Security findings (summary; details in SECURITY.md sections 4b and 4c)

| Severity | Count | Notes |
|---|---|---|
| High | 0 | |
| Medium | 7 fixed | Pasted copy stealing an id; Undo after load blanking the page; deleted id moved to another block. Review r2: empty-doc reply to requestDoc (M1), last word lost on leave/background (M2), WebView crash recovery (M3), developer menu in release builds (M4) |
| Low | 11 fixed, 2 accepted | Fixed: UTF-16 tag read, redaction gaps, in-app links (C1), silently dropped edits; review r2: backslash/IDN link spoofing (L1), pasted tables (L2), keyboard-made splits (L3), editor-web imports (L4), WAL after purge (L5), Undo for empty notes (L6); Gaegu font silently skipped (P1-S24, cap 4.5 M, TODO P5 subsets). Accepted: no DB encryption in P1 (Q5), `style-src 'unsafe-inline'` |
| Info | 4 | TipTap `window.open` unreachable; diagnostics metadata-only; keyboards unverified; RNTL removed |

## 6. Export contents check

Same export script as P0: source, config, docs and assets only (including the 6 app icons, which are not in
GitHub); excludes `node_modules`, `.git`, `.expo`, `dist*`, `exports`, `android`, `ios`, `.env*` (except
`.env.example`), keystores, `.p8/.p12/.pem/.key`, Google service files and build artefacts; aborts on any
private-key, Groq, Google, OpenAI, GitHub, Expo-token or service-account pattern. File list:
`exports/<zip>.contents.txt`.

## 7. Known limits

- The **developer menu** (Typing diagnostics, P0 spikes) exists only in Expo Go / dev mode and EAS
  development builds, not in the preview APK (review M4). Typing diagnostics: run them in Expo Go.
- **Keyboards unverified** on real phones (Gboard composition, keyboard covering the toolbar). Conservative
  input settings plus Typing diagnostics; tune after the device check.
- Draw mode is a placeholder (P4b); no AI screens (P3b); no accounts or sync (P2b); review parts of Home (P4c).
- Folders show one level in the screens; drag-to-reorder is replaced by Move up / Move down.
- No database encryption at rest (decision Q5).
- Expo Go in the stores runs only the newest Expo SDK; if it moves past SDK 58, use the APK or upgrade.
- App identity confirmed by Rey (Nov 1): display name **NotedPo**, Android package and iOS bundle id
  `io.github.bantutti.notedpo`, URL scheme and Expo slug `notedpo`. No P0 placeholder ids remain (test-enforced).
- Backend tests were not re-run in this sandbox (no Java); `firebase/` is unchanged since the P2a merge.

## 8. What is next

1. Rey: run TESTING_ON_DEVICE section 8 (P1, 33 checks; Typing diagnostics in Expo Go) in Expo Go and the APK, including Typing
   diagnostics with each keyboard, and send the results.
2. Lead: review and merge PR #5.
3. Then wave 2: P2b (accounts and sync: add the `@grpc/grpc-js` override with the Firebase SDK, run
   `ensureBlockIds` before every upload, use `toCloudDoc`) and P3b (AI screens through the editor action hook).
