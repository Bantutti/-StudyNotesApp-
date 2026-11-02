# Architecture

Phase: **P1 (core app)**, with P2a (backend) and P3a (AI engine) merged. This describes what exists now
and the rules every later phase follows.

## Stack

| Layer | Choice (pinned) | Why |
|---|---|---|
| App framework | Expo SDK 58, React Native 0.88, React 19.3, TypeScript 6 (strict) | One codebase for Android and iPhone; EAS builds iOS without a Mac |
| Navigation | Expo Router 58 (`src/app/`): stack + bottom tabs | File-based routes, the Expo default |
| Local data | expo-sqlite 58.0.15 (SQLite with FTS5), in Expo Go | Local-first notes, full-text search, no account needed |
| Icons | @expo/vector-icons 15.1.1 (Ionicons) | Bundled in Expo Go |
| Editor | TipTap 3.32 (+ extension-table) inside `react-native-webview` 14 | Rich text with a JSON document model; runs offline in a locked-down WebView |
| Validation | zod 4.6 | One schema language at every trust boundary, shared by app and WebView |
| Scheduling | ts-fsrs 6.0 (FSRS-7 model) | Modern spaced repetition, pure TypeScript |
| Drawing | @shopify/react-native-skia 2.14 + Gesture Handler 3.3 + Reanimated 4.7 | Ink is drawn on the UI thread |
| Audio | expo-audio 58 | Recording with a background mode (dev build) |
| Export | expo-print (PDF, print), docx 9.15 (DOCX) | PDF from the same HTML/CSS as the editor; DOCX in pure JS |
| Secrets | expo-secure-store (Keychain / Keystore) | User AI keys never leave secure storage except to call the provider |
| Fonts | @expo-google-fonts (SIL OFL): the 22 families of the 13 v1 packs (P5) | Bundled, licence allows embedding in PDF/DOCX. The four large Korean/Japanese families without Reserved Font Names (Gaegu, Gowun Dodum, Mochiy Pop One, Zen Maru Gothic) ship as generated Latin subsets (`npm run build:fonts`), so `MAX_FONT_BASE64` is back to 3 M (largest face: Nanum Gothic Bold, 2.76 M). Fonts still cross the bridge one face per message (P1 PR #9) |

## Modules

```
          src/app (routes: tabs, onboarding, note editor, subjects, search, history, style, dev)
                │   src/screens (shared screen pieces: NoteCard, NoteBrowser, EditorToolbar, sheets)
                ▼   useServices() · useAppData() · use cases
          src/composition ── the ONLY place adapters are chosen; app use cases live here
   ┌──────┬────────┬──────────┬────────┬───────────┬─────────┬────────┬──────┬──────┬──────┬────┐
   ▼      ▼        ▼          ▼        ▼           ▼         ▼        ▼      ▼      ▼      ▼
 store  editor  templates  beautify  stylepacks◄─lookmatch  export   review   voice   ink   aiui ─► ai
   │      │                                                                       │      │
 SQLite  editor-web (TipTap page inside the WebView)                  AI screens  provider HTTPS
   │
   └── tables mirror firebase/src/schemas (P2a); P2b syncs them      all modules depend on src/core
```

| Module | Responsibility | Public interface (index.ts) |
|---|---|---|
| `core` | Logger with redaction, errors, Result/validation, document model v2 + block ids + structure rules, cloud limits mirror (`utf16String`, `syncedText`), document storage prep, text extraction, colour maths, strings, results log, platform adapters, UI kit and chrome tokens (`core/ui`) | [modules/core.md](modules/core.md) |
| `store` | SQLite: tables that copy P2a's cloud docs, numbered migrations, repositories (subjects, folders, notes, versions, settings), block-level FTS5 search, undo-then-wipe deletes, Delete all data | [modules/store.md](modules/store.md) |
| `editor` | WebView host, bridge protocol, WebView hardening, links opened outside the app, page previews, the **editor action hook** for P3b, generated CSP-pinned page | [modules/editor.md](modules/editor.md) |
| `templates` | Template schema v1 (validated data), 7 built-ins, instantiate/apply with fresh block ids | [modules/templates.md](modules/templates.md) |
| `beautify` | Beautify Lite: on-device rules that never change words and keep block ids | [modules/beautify.md](modules/beautify.md) |
| `stylepacks` | Pack schema v3, contrast rules, pack -> CSS variables, decor, bundled fonts (22 OFL families, 4 as generated Latin subsets); the 13 v1 packs plus validated custom packs (registry), PackPicker | [modules/stylepacks.md](modules/stylepacks.md) |
| `export` | PDF / DOCX / print exporters behind `Exporter` + ports (P1 blocks render; P6 polishes) | [modules/export.md](modules/export.md) |
| `review` | FSRS scheduler wrapper, append-only logs, rebuild, on-device self-test (P4c builds on it) | [modules/review.md](modules/review.md) |
| `voice` | Recording presets, session monitor, recordings folder, transcription port + Groq adapter (P4 builds on it) | [modules/voice.md](modules/voice.md) |
| `ink` | Drawing (P4b): ink file format v1 with a zod trust boundary, block-unit anchors and reconcile, geometry (smoothing, pressure outlines, RDP, eraser and lasso hit tests, safe SVG paths), immutable layer ops with tombstones, undo, union merge, the Draw-mode controller, live Skia overlay with stylus-aware routing, toolbars, local save/publish service, sync hand-off ports, diagnostics bench. Maths in [INK_MATH.md](modules/INK_MATH.md) | [modules/ink.md](modules/ink.md) |
| `ai` | AI engine (P3a): BYOK keys (Groq, Mistral), provider port with an OpenAI-compatible adapter, fixed-host transport (timeouts, retries, TPM pacing), 11 actions with versioned prompts and zod output schemas, alias-based block-id preservation, proposals with apply/rebase/exact undo, card and quiz drafts in P2a fields, local usage meter. No screens yet (P3b). | [modules/ai.md](modules/ai.md) |
| `lookmatch` | Match a look (P5): reference photo intake (caps, metadata strip), on-device analysis (OKLab palette, paper pattern, roles, multi-photo), nearest pack, contrast repair, blend slider, chips, optional Groq vision pass (enum-only). Maths in `MATCH_MATH.md` | [modules/lookmatch.md](modules/lookmatch.md) |
| `store` (P2b) | Migration 2: `syncOutbox` filled by SQLite triggers (every local insert/update; nothing for deletes), `syncState` (bound account, applying flag), exact pull cursors, `syncConflicts`, `syncQuarantine`, `syncFiles`; the `store.sync` API keeps all SQL in the store | [modules/sync.md](modules/sync.md) |
| `sync` (P2b) | Engine: push (profile first, batches split on refusal, lost-ack detection), pull (cursor + 60 s overlap, zod on every doc, quarantine), conflicts (resolver for notes, cards, recordings; automatic for the rest), tombstones erased, review-log union, asset pass with `registerAssetMerger`, scheduler; a rules-faithful fake cloud for tests | [modules/sync.md](modules/sync.md) |
| `cloud` (P2b) | Firebase JS SDK setup (config with emulator-only-for-demo rule, memory cache, long polling, SDK logs silenced), Firestore `RemoteBackend`, Storage `BlobStorePort`, React Native session persistence | [modules/cloud.md](modules/cloud.md) |
| `auth` (P2b) | Sign-in (email fully; Google/Apple Firebase half behind ports, hidden), scope pins, name/photo scrub, SecureStore session, one account per phone, account deletion wiring (Apple revoke, P2a `deleteAccount`) | [modules/auth.md](modules/auth.md) |
| `applock` (P2b) | Lock rules (pure), LockGate (nothing mounted before the first unlock; opaque cover when inactive), expo-local-authentication and expo-screen-capture adapters | [modules/applock.md](modules/applock.md) |
| `legal` (P2b) | C1's in-app privacy, terms and account-deletion pages, bundled and pinned (`check:legal`), safe Markdown subset | [modules/legal.md](modules/legal.md) |
| `aiui` | AI screens (P3b): the 18+ birth-year check, key wizard (test before save), consent per provider and version, action sheet, run progress with Cancel, diff preview with per-block toggles, local reports, Me → AI settings, Demo AI (dev builds only). One `ai` editor action in the sparkle slot; the flow is a modal state machine. | [modules/aiui.md](modules/aiui.md) |
| `auth`, `sync` | **Planned for P2b.** Not created yet. | |

**Composition** (`src/composition`) also holds the app's use cases, all unit-tested on real SQLite:
onboarding (`finishOnboarding`, `skipOnboarding`), notes (`createNoteIn` with subject default pack and
template), Home (`homeSummary`, exam countdowns), templates (`applyTemplateToNote`), style
(`applyPackToNote`), versions (`checkpointWhileEditing`, `checkpointOnLeave`), editor actions
(`runEditorAction`, `beautifyLiteAction`), autosave (`createAutosave`, `createNoteSession`), search
(`createSearchController`) and the app data lifecycle (`createAppDataController`: open, undo, wipe, reset).
P4b adds `inkServiceFor` / `inkStorePort` (`composition/ink.ts`, one ink service per Store, crash recovery
and orphan sweep at start) and `createNoteInk` (`composition/noteInk.ts`: one note's ink while the editor is
open), used by `src/screens/NoteInk.tsx` and the note screen.
P2b adds the cloud runtime (`cloudRuntime.ts`: built only with a valid `EXPO_PUBLIC_FIREBASE_*` config, so
`services.cloud` is null in local-only builds), the sync controller (`syncController.ts`: one view model for
every sync screen, Turn on sync, sign-out, account gone), `SyncBridge` and `AppLockGate` (mounted in the
root layout), and hooks `useSyncView` / `useNoteSync`. P2a's schemas and deletion module are imported only
through `src/modules/sync/cloudSchemas.ts` and `src/modules/auth/p2aDeletion.ts`; `metro.config.js` maps
their `.js` specifiers and hides `firebase/node_modules` so the bundle has one SDK and one zod.

### Module rules (enforced)

1. **Public index only.** Code outside a module imports `@/modules/<name>`, never
   `@/modules/<name>/<file>`. ESLint `no-restricted-imports` fails the build otherwise. Core is
   imported as `@/core` (UI pieces: `@/core/ui`).
2. **External services behind ports.** Printing, files, sharing, secure storage, fetch, assets
   and random bytes are interfaces (`PrintPort`, `FileWriterPort`, `SecretStorePort`,
   `TranscriptionProvider`, ...). Expo adapters live next to them; tests inject fakes.
3. **No global state.** `createServices()` builds everything once in the root layout and passes it
   down through React context (`ServicesProvider` / `useServices`). Tests call
   `createServicesWith(fakeAdapters)`.
4. **Validate at boundaries.** Anything from the WebView, storage, the network or (later) AI and
   sync goes through a zod schema first: `validateNoteDoc`, `validatePack`, `spikeResultSchema`,
   bridge `toWebSchema`/`toNativeSchema`, Groq `responseSchema`, `reviewLogSchema`.
5. **Every module has tests** in its `__tests__/` folder.
6. **The editor page's one allowed exception.** `editor-web/` is bundled separately into the WebView
   (no `@/` alias, no React Native), so it imports shared code by **relative path**, and only from
   three dependency-free places: `src/core/document` (schema, parse, ids: the same document rules on
   both sides of the bridge), `src/modules/editor/protocol` (the bridge messages) and
   `src/modules/stylepacks/web` (pack CSS and fonts, the web-safe subset of stylepacks). ESLint
   allows exactly these paths for `editor-web/` and rejects any other `../../src/...` import, so
   nothing native (Expo, React Native, storage) can leak into the page bundle.

## Key data structures

**Note document (`core/document`, schema v2).** ProseMirror/TipTap JSON. Nodes: paragraph, heading (1 to
3), bulletList, orderedList, listItem, callout, definition (`term`), horizontalRule, hardBreak, text, and
since P1 blockquote, summary, qa (qaQuestion + qaAnswer), columns (`layout` even or cornell, exactly two
columns, not nested) and simple tables (table > tableRow > tableHeader | tableCell, no merged cells, at most
12 columns and 200 rows). Marks: bold, italic, underline, strike, highlight (`key` k0 to k5), link (http,
https or mailto only). `checkDocStructure()` enforces nesting; the editor's content expressions mirror it.
Limits: the cloud's 600,000 characters and 900,000 bytes, depth 16, 50,000 nodes.

**Stable block ids.** Every block carries `attrs.blockId` (`b_` + 16 random chars; decision Q7, the same
attribute P2a's cloud schema reads). Read it with `getBlockId()`. Ids survive edits, Enter, turn-into,
undo, moves, Beautify, templates, restore and pack switches; pasted copies and duplicates get fresh ids;
cut + paste keeps them (decision Q6). Every block may carry `audioAnchor` (P2a's shape, used from P4).

**Local database (`store`, migration 1).** Synced tables copy P2a's cloud docs field for field: `users,
subjects, folders, notes, cards, reviewLogs, recordings, assets, stylePacks, templates` with `id, owner,
schemaVersion, created, updated, rev, deleted` (guest: owner NULL, rev 0). Local only: `noteVersions`
(last 20 per note), `kv`, and the FTS5 index `search` + `searchMap` (one row per text block). STRICT tables,
no foreign keys between synced tables (sync order is arbitrary). The contract test proves every row maps to
a valid cloud doc (`toCloudDoc` is the reference mapping for P2b).

**Highlights store a key, not a colour.** `highlight{key:'k2'}` means "the pack's third highlighter". P1's
two packs share the meanings and order (Key idea, Definition, Example, Formula), so switching keeps meaning.

**Review logs (`review`).** Append-only `{id, cardId, reviewedAt, grade}`, merged by union and replayed.

**Spike results (`core/results`).** JSONL, metrics only (developer menu).

## How the app connects (P1)

**Start-up.** The root layout builds Services, the theme (system light/dark) and the app data controller,
which opens SQLite, runs migrations, sets `secure_delete`, purges expired deletions and shows a loading or
error screen. `/` sends first-time users to onboarding, everyone else to Home.

**Editing.** The note screen loads the note into `EditorView`. The page posts a validated document 400 ms
after each change; `createNoteSession` autosaves it 1 s later (at least every 5 s, flushed on background
and leave), running the 10-minute version rule first. One transaction stores the note and its search rows.
The keyboard toolbar sends commands; the page reports toolbar state. Links go to the native "Open link?"
dialog, then the OS browser.

**Editor actions (P3b hook).** Beautify Lite and the AI run through `runEditorAction`: current
document from the page, `action.run()`, schema check, "Before …" version, save, show, exact Undo.

**AI (P3b).** `composition/aiWiring.tsx` (mounted once under AppDataProvider) registers the `ai` action
in the sparkle slot and renders `AiFlowHost`, a React Native Modal. `run()` calls `flow.start(ctx,
subjectAiAllowed)`: action sheet, then (only as needed) age check, key wizard and consent, then
`engine.run()`, the diff preview, and `applyProposal()`. It resolves with the new document, and
`runEditorAction` saves "Before AI change". Closing the modal is a cancel (`AppError('cancelled')`, no
message). Age, consent and reports live in `documents/ai/*.json`; keys live only in secure storage.

**Search.** `createSearchController` debounces input into `store.search()`, which turns the text into safe
quoted prefix terms, ranks titles and terms above text, and returns plain-text snippet parts grouped by
note. Tapping opens the note at the block (`scrollToBlock`).

## Backend (Firebase, P2a)

- Firestore uses **top-level collections** (`users, subjects, folders, notes, cards, reviewLogs, recordings,
  assets, stylePacks, templates`), each doc with `owner`. Storage uses
  `users/{uid}/{audio|images|ink|attachments}/{assetId}.{ext}`.
- The note document, recording segments and pack/template definitions are **capped JSON strings**
  (Firestore's 20-level nesting limit; rules can't measure maps).
- Lifecycle on every synced doc: `schemaVersion, created/updated (server time), rev (old + 1), deleted
  (tombstone)`. Review logs are create-only and merged by union.
- Account deletion is client-driven (`firebase/src/deletion`), with a rules-level "deletion in progress" lock.
- `firebase/src` (schemas) is SDK-free and is imported by P1's contract tests; `firebase/src/deletion`
  needs the Firebase JS SDK (P2b). `firebase/` is a **separate npm project** (own lockfile; the root
  TypeScript and ESLint configs skip it).
- Details: [backend/DATA_MODEL.md](backend/DATA_MODEL.md).

## How the P0 spikes connect (developer menu)

**Editor.** `EditorView` loads `generated/editorHtml.ts` (built by `scripts/build-editor.mjs`
from `editor-web/`). The page has one inline script pinned by a SHA-256 CSP hash and no network.
Native sends `load` (doc), `setPack` (pack JSON), `setFonts` (base64 faces, **one face per message**: the
first replaces, the rest carry `append: true`, because Pastel's faces together exceed the 6 M-char bridge
limit), `command`, `requestDoc`
and `ping`. The WebView re-validates each, applies it, and sends `ready`, `doc` (debounced 400 ms),
`metric`, `pong` and `error`. Native validates every inbound message and every document again.

**Export.** `renderExportHtml(doc, pack, faces)` produces standalone HTML with the same
`packCss()` the editor uses plus print rules and a no-script CSP. `expo-print` turns it into a PDF
or prints it. `buildDocx()` maps the same document to Word paragraphs with embedded fonts.

**FSRS.** `createScheduler()` (FSRS-7, fuzz off). `runFsrsSelfTest()` replays a fixed history and
compares with golden values computed in Node, then checks merge-order independence and throughput.

**Recording.** expo-audio records with the Speech preset into the document folder. The screen
samples recorder duration against the wall clock every 15 s and on every app-state change;
`summarize()` turns samples into coverage, gaps, size and battery numbers; `judgeRecording()` decides.

**Timestamps.** `createGroqTranscriber()` uploads a recording with the user's key and gets word and
segment timestamps (`verbose_json`). The screen computes WER against the reading script, structure
checks, tap-to-seek accuracy and tap-along drift.

**Ink.** `InkCanvas` runs a pan gesture as worklets; each stroke grows an `SkPathBuilder` and
publishes `build()` snapshots to shared values that Skia draws. A frame callback fills a 1 ms
frame-interval histogram; the screen polls stats every 500 ms.

## Key decisions and why

| Decision | Why | Alternatives rejected |
|---|---|---|
| TipTap bundled into one inline script, CSP-pinned by hash | No network at all in the editor; nothing else can execute even if content is hostile | Loading TipTap from a CDN (network + supply chain); `unsafe-inline` scripts |
| Same CSS for editor and export | Export fidelity is the P0 risk; one style engine means one place to fix | Separate print styles |
| Pack -> CSS variables only, static component CSS | A pack (later AI- or user-made) can never inject CSS | Packs carrying CSS |
| zod in the WebView too (`jitless`) | Defence in depth; jitless avoids `new Function` under the CSP | Trusting native input |
| Ports and adapters with a composition root | Swappable providers (AI, transcription, export engines) and fully testable logic | Calling Expo modules from screens |
| FSRS fuzz off + log replay | Deterministic across devices, so sync is a set union | Syncing card state (conflicts) |
| Results log = metrics only | Safe to paste into chats and bug reports | Logging raw transcripts or notes |
| Speech preset 32 kbps mono AAC | 90 minutes ≈ 21.6 MB fits Groq's 25 MB limit in one upload | High quality (≈ 86 MB per 90 min) |
| Expo Router + `src/app` | Expo default; deep links later | React Navigation config by hand |
| No backend in P0 | Phase rule; removes a whole attack surface while spiking | Early Firebase |
| Local tables copy the cloud docs field for field (P1) | P2b's sync is a straight copy; a contract test runs P2a's schemas on every row | Local-only shapes plus a mapping layer |
| Plain SQL migrations with `PRAGMA user_version`, tested on Node's built-in SQLite (P1) | No ORM dependency; real FTS5 and migration tests in Jest | Drizzle (3 new dependencies) |
| One FTS5 row per text block (P1, Q10) | Results open at the matching line; the same index serves "Ask my notes" later | Note-level index |
| Delete: 8 s Undo, then wipe text, keep a tombstone (P1, Q11) | Privacy (no deleted text lingering), and sync can still delete the cloud copy | 30-day trash |
| Smart paste and in-place id restore (P1, Q6) | Cards and audio anchors keep pointing at the right text through every edit | Always-fresh ids on paste |
| Editor actions as one registry and one run path (P1) | Beautify Lite and P3b's AI share validation, versions and exact Undo; P3b touches no editor internals | AI screens calling the store directly |
| Slash menu inside the page, toolbar native (P1) | Pack-accurate previews without per-keystroke bridge traffic; toolbar is fast and accessible | All-native menus |
| Conservative IME handling plus Typing diagnostics (P1) | Android keyboards are unverified; data from real phones instead of guesses | Custom key handling for shortcuts |
| Hybrid ink rendering (P4b, Q1): finished strokes as SVG inside the WebView, live stroke in a native Skia overlay | Ink scrolls, reflows and prints with the text natively (no scroll-sync drift) and the stroke being drawn stays low-latency; both use the same TS geometry, so committing never moves the line | Native-only overlay synced to WebView scroll; WebView-only pointer drawing |
| Ink in block units (P4b, Q3): 1000 = anchor block width, same scale on both axes | Strokes follow their block through edits and scale across devices without distortion | Absolute page coordinates (break on every edit) |
| Ink saved locally while drawing, published once per visit (P4b, Q9) | P2b uploads at most once per note visit (Storage free tier: 5K uploads/month) and the uploaded file never changes mid-upload | Publishing every stroke or on background |
| Immutable strokes + tombstones, merge = set union (P4b, Q10) | Two devices drawing offline converge without losing strokes; laws property-tested | Last-push-wins per file |
| AI screens as a modal over the note, not pushed routes (P3b) | The note keeps its editing session (no "left the note" save, no reload), and no note text or key ever goes into navigation params | Expo Router routes for each AI step |
| The 18+ gate is a birth-year question with only the result stored (P3b, Rey Nov 1) | Neutral prompt (no hint of the cut-off), month or day asked only when needed, nothing identifying kept | An "I'm 18 or older" checkbox; storing the birth date |
| AI edits are proposals, never direct writes (P3a) | The AI sees block aliases, not ids; output is schema data with five inline marks, so no links or HTML can come from the AI. Undo is exact only while the note is unchanged; otherwise use version history | Letting the AI return documents |

## Known structural limits (to revisit)

- **Android/iOS keyboard behaviour in the editor is unverified on real phones** (Gboard composition,
  keyboard covering the toolbar). Typing diagnostics collect data; tune in the device check.
- Editor script is about 586 KB (TipTap + tables + zod). If boot is slow on low-end phones, move the
  WebView schemas to a lighter validator.
- `style-src 'unsafe-inline'` in the editor CSP (needed to inject pack and font CSS). See SECURITY.md.
- The note screen's toolbar sits above the keyboard through `KeyboardAvoidingView` (iOS padding, Android
  height); a native keyboard-controller library would need a development build.
- Folders show one level in the screens (the data model supports nesting).
- Palm rejection is decided per gesture (P4b: per-touch tracking).
