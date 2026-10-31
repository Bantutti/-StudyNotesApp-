# Architecture

Phase: **P0 (spike lab)**. This describes what exists now and the rules every later phase follows.

## Stack

| Layer | Choice (pinned) | Why |
|---|---|---|
| App framework | Expo SDK 58, React Native 0.88, React 19.3, TypeScript 6 (strict) | One codebase for Android and iPhone; EAS builds iOS without a Mac |
| Navigation | Expo Router 58 (`src/app/`) | File-based routes, the Expo default |
| Editor | TipTap 3.32 inside `react-native-webview` 14 | Rich text with a JSON document model; runs offline in a locked-down WebView |
| Validation | zod 4.6 | One schema language at every trust boundary, shared by app and WebView |
| Scheduling | ts-fsrs 6.0 (FSRS-7 model) | Modern spaced repetition, pure TypeScript |
| Drawing | @shopify/react-native-skia 2.14 + Gesture Handler 3.3 + Reanimated 4.7 | Ink is drawn on the UI thread |
| Audio | expo-audio 58 | Recording with a background mode (dev build) |
| Export | expo-print (PDF, print), docx 9.15 (DOCX) | PDF from the same HTML/CSS as the editor; DOCX in pure JS |
| Secrets | expo-secure-store (Keychain / Keystore) | User AI keys never leave secure storage except to call the provider |
| Fonts | @expo-google-fonts (SIL OFL) | Bundled, licence allows embedding in PDF/DOCX |

## Modules

```
                    src/app (screens)
                         │  useServices()
                         ▼
                 src/composition  ── the ONLY place adapters are chosen
        ┌───────────┬────┴─────┬──────────┬────────┬────────┬──────┐
        ▼           ▼          ▼          ▼        ▼        ▼      ▼
     editor      export     review      voice     ink       ai   stylepacks
        │           │                     │                         ▲
        │           └──── uses ───────────┼──── packs, fonts ───────┘
        ▼                                 ▼
   editor-web (inside WebView)        Groq API (HTTPS, user's key)
        │
        └──────────────► all modules depend on src/core
```

| Module | Responsibility | Public interface (index.ts) |
|---|---|---|
| `core` | Logger with redaction, errors, Result/validation, document model + block ids, results log, stats, base64, escaping, platform adapters, UI kit (`core/ui`) | see [modules/core.md](modules/core.md) |
| `stylepacks` | Pack schema v3, contrast rules, pack -> CSS variables, decor, bundled fonts | [modules/stylepacks.md](modules/stylepacks.md) |
| `editor` | WebView host, bridge protocol, WebView hardening, generated CSP-pinned page | [modules/editor.md](modules/editor.md) |
| `export` | PDF / DOCX / print exporters behind `Exporter` + ports | [modules/export.md](modules/export.md) |
| `review` | FSRS scheduler wrapper, append-only logs, rebuild, on-device self-test | [modules/review.md](modules/review.md) |
| `voice` | Recording presets, session monitor, recordings folder, transcription port + Groq adapter, WER and drift maths | [modules/voice.md](modules/voice.md) |
| `ink` | Skia ink surface, palm-rejection policy, smoothness stats | [modules/ink.md](modules/ink.md) |
| `ai` | BYOK key format, masking, key vault over a secure-storage port | [modules/ai.md](modules/ai.md) |
| `auth`, `sync` | **Planned for P2.** Not created yet (rule: build only the current phase). | |

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

## Key data structures

**Note document (`core/document`).** ProseMirror/TipTap JSON. Allowed nodes: paragraph, heading
(1 to 3), bulletList, orderedList, listItem, callout, definition (with `term`), horizontalRule,
hardBreak, text. Marks: bold, italic, underline, strike, highlight (`key` k0 to k5), link (http,
https or mailto only). Limits: 2 MB JSON, depth 16, 50,000 nodes, 20,000 characters per text node.
Unknown attributes are stripped.

**Stable block ids.** Every block carries `blockId` (`b_` + 16 random chars). Ids survive edits,
new blocks get new ids (`keepOnSplit: false`), and pasted duplicates are re-issued. Flashcards,
audio anchors and versions will point to block ids (plan v0.2), so they must never silently change.

**Highlights store a key, not a colour.** `highlight{key:'k2'}` means "the pack's third
highlighter". Switching packs recolours every note, and exports composite the colour over paper
exactly like the validator does.

**Review logs (`review`).** Append-only `{id, cardId, reviewedAt, grade}`. Devices merge logs by
union on `id`, sort by `(reviewedAt, id)`, and rebuild card state by replay. Fuzz is off, so the
same log gives the same card on every device: no review conflicts to resolve.

**Spike results (`core/results`).** JSONL in the app's document folder, schema-checked on read and
write, at most 500 entries. Metrics only: numbers, booleans and short strings (max 200 chars, max 40
keys). No note text, transcripts, file names or keys.

## How the pieces connect (per spike)

**Editor.** `EditorView` loads `generated/editorHtml.ts` (built by `scripts/build-editor.mjs`
from `editor-web/`). The page has one inline script pinned by a SHA-256 CSP hash and no network.
Native sends `load` (doc), `setPack` (pack JSON), `setFonts` (base64 faces), `command`, `requestDoc`
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

## Known structural limits (to revisit)

- Editor script is about 500 KB (zod is ~40% of it). If boot time on low-end phones is slow, move the
  WebView schemas to `zod/mini` or hand-written validators in P1.
- `style-src 'unsafe-inline'` in the editor CSP (needed to inject pack and font CSS at runtime). See SECURITY.md.
- Palm rejection is decided per gesture; a palm touching first can block the pen (P4b: per-touch tracking).
