# Changelog

All notable changes, one section per phase.

## P1: core app (2026-11-01)

### Added
- **Local data (store module):** SQLite (expo-sqlite) with tables that copy P2a's cloud docs field for field,
  numbered migrations, repositories for subjects, folders, notes, versions and settings, block-level FTS5
  search, 8-second undo then wipe, Delete all data. Cloud contract tests against `firebase/src/schemas`.
- **Document model v2:** quote, summary, Q&A, two columns (even or Cornell), simple tables, `audioAnchor` on
  every block, structure rules, cloud size caps; `BLOCK_ID_ATTR = 'blockId'` and `getBlockId()`.
- **App:** tabs Home · Subjects · (+) · Me; onboarding (Welcome, Pick your look on the real sample page, first
  subject, Sample note, Skip anywhere); Home (search, continue, exam countdowns, recent); Subjects, folders and
  Inbox with sort, tags, move and delete with Undo; light and dark chrome (plan 9.5 tokens with contrast fixes);
  strings table; hidden developer menu with the P0 spikes and **Typing diagnostics**.
- **Editor:** the live TipTap editor with autosave (1 s, max 5 s, flushed on background and leave), keyboard
  toolbar (text styles, the pack's highlighters, lists, + block, block menu, P3b sparkle slot, Beautify,
  undo/redo), slash menu and block picker with pack previews, typing shortcuts (`#`, `-`, `1.`, `>`, `---`,
  `==text==`, `Term :: meaning`), Info (word count, outline), focus mode, search-to-line.
- **Stable block ids:** Enter at line start, paste above, turn-into, smart paste, cut-move, duplicate, move,
  undo; IME-safe (nothing runs while composing).
- **Templates** (7 built-ins as validated data), **Beautify Lite** (on-device, words never change, ids kept,
  idempotent), **editor action hook** for P3b, **version history** (rules, History, preview, Restore),
  **Style sheet** on the student's own note, **Clear Read v2** (4 highlighters) with Atkinson Hyperlegible.
- **Links open outside the app** (Apple age-rating rule): native confirm, then the OS browser.
- Core: ErrorCode `cancelled` and `consent` (P3a follow-up); `syncedText` UTF-16 validators (P2a follow-up).

### Changed
- App identity (confirmed by Rey): display name **NotedPo** (`app.json` name and the strings table), Android package
  and iOS bundle id `io.github.bantutti.notedpo`, URL scheme and Expo slug `notedpo` (were P0 placeholders).
- P0 spike screens moved under `/dev` (developer menu). `expo-crypto` and `expo-device` pinned exactly.
- Export renders the new blocks (basic; P6 polishes). Editor script about 586 KB.

### Dependencies
- Added: `expo-sqlite` 58.0.15, `@expo/vector-icons` 15.1.1, `expo-system-ui` 58.0.7,
  `@expo-google-fonts/atkinson-hyperlegible` 0.4.1, `@tiptap/extension-table` 3.32.2 (dev, bundled into the page).

### Security
- See SECURITY.md section 4b: three Medium findings fixed (P1-S1 to S3), no open High or Medium.

## P3a: AI engine module (Nov 2026)
- AI engine behind src/modules/ai: Groq (gpt-oss-120b → 20b fallback) and Mistral adapters, fake adapter.
- Provider catalog with 18+ rule, data use, free limits (checked 2026-11-01).
- 11 actions with versioned prompts and zod output schemas; card/quiz drafts in P2a fields.
- Alias-based block-id preservation, proposals with block-level rebase and exact undo.
- Fixed-host HTTPS transport: timeouts, cancel, retries (429 ≤ 10 s once), TPM pacing.
- Local usage meter (JSON file, 30 days, no content).
- 95 new tests (85 always-on incl. the key-leak test on every failure path, 10 opt-in live tests).

## P2a: Backend (Nov 2026)
- Added firebase/ (own package.json + lockfile): emulator config for demo-studynotes, firestore.rules,
  storage.rules, firestore.indexes.json.
- Added zod schemas for every cloud document (field names from Plan v0.2 §12), with UTF-16-accurate
  string caps that match the rules; block ids read from `attrs.blockId` (non-null on top-level blocks).
- Added emulator tests (601 at merge): access, lifecycle, review logs, storage, limits probes, generated
  schema/rules agreement cases, account deletion end to end, admin deletion script.
- Added in-app account deletion module (resumable, no Cloud Functions) and the admin script for
  Google Play web deletion requests.
- Docs: docs/backend/* (data model, limits, deletion, App Check and budget plan, security review,
  Windows test guide).

## P0: prototype spike lab (2026-11-01)

### Added
- Expo SDK 58 + TypeScript (strict) project with Expo Router, exact dependency pins, lockfile,
  ESLint (module-boundary rule), Jest (app + WebView projects), secretlint, EAS development profile.
- **Spike lab app:** home screen with last verdict per spike, results log (copy as Markdown),
  Groq key settings.
- **Editor spike:** TipTap 3 bundled offline into a CSP-hash-pinned WebView page; validated bridge;
  stable block ids; callout, definition and pack-keyed highlight blocks; pack and font switching;
  boot/load/bridge metrics.
- **Export spike:** PDF and print via expo-print using the editor's own pack CSS and embedded fonts;
  DOCX via docx 9 with embedded fonts, highlight shading and page background; visual checklist.
- **FSRS spike:** ts-fsrs 6 (FSRS-7) wrapper, append-only review logs with union merge and replay,
  golden-vector self-test for Hermes, sample flashcard.
- **Recording spike:** 32 kbps mono speech preset (90 min ≈ 21.6 MB), background recording config
  (Android dev build), wall-clock vs recorder session monitor, battery and size projections.
- **Timestamp spike:** Groq Whisper adapter (word + segment timestamps, glossary prompt), consent
  before upload, WER vs reading scripts (English, Taglish, Cebuano-mixed), tap-to-seek and
  tap-along drift tests.
- **Ink spike:** Skia + Gesture Handler 3 + Reanimated worklet drawing, palm-rejection modes,
  frame-interval histogram, sample rate and pressure stats.
- Style packs schema v3 ported to TypeScript with all 13 packs validated; bundled OFL fonts for the
  P0 packs (Gaegu, Nunito, Cinzel, Crimson Pro).
- Docs: README, TESTING_ON_DEVICE, ARCHITECTURE, SECURITY, module docs, this changelog, P0 report.
- Phase export script with path exclusions, secret content scan, deterministic zip and checksum.

### Security
- See SECURITY.md section 4: two Medium findings fixed (paste sanitizer, tooling advisories), no
  open High or Medium.

### Fixed during the phase
- Groq adapter rejected the app's own recording file names (uppercase `T`); caught by tests.
