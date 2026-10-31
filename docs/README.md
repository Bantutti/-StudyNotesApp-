# Study Notes App: developer README

## What it is

A study note-taking app for Android and iPhone built around one loop: **Capture, Shape, Review, Recall**.
Notes look like aesthetic handwritten study notes (style packs such as Pastel Highlight), and the app
adds voice notes with word-level timestamps, pen or finger drawing, spaced-repetition flashcards (FSRS)
and export to PDF, DOCX and print. It works with no account and no AI key; sign-in only turns on sync
(P2), and AI uses the student's own free provider key (P3).

## Current phase: P0, the spike lab

P0 is **not the app yet**. It is a test lab that answers the five riskiest technical questions on real
phones before P1 starts:

| # | Spike | Question it answers |
|---|---|---|
| 1 | Editor | Does TipTap inside a locked-down WebView load fast and switch packs cleanly? |
| 2 | Export | Do PDF, DOCX and print look like the screen, fonts included? |
| 3 | FSRS | Does ts-fsrs give identical results on the phone (Hermes) and in Node? Do review logs merge? |
| 4 | Recording | Does a 90-minute recording survive the screen being locked? How big, how much battery? |
| 5 | Timestamps | Are Groq Whisper word timestamps accurate enough for tap-to-replay (English, Taglish, Cebuano-mixed)? |
| 6 | Ink | Is pen/finger drawing smooth on a tablet? Does palm rejection work? |

Each spike measures itself and saves **metrics only** to an on-device results log you can copy.

## Requirements

- **Node.js 24 LTS** (the project refuses other majors: `engine-strict`). npm 11 comes with it.
- Git (optional but recommended).
- A phone with **Expo Go** (free) for most spikes. The 90-minute background recording needs the free
  Android development build (see TESTING_ON_DEVICE.md, section 4b).

## Setup

```bash
npm ci                      # exact versions from package-lock.json
copy .env.example .env      # Windows (macOS/Linux: cp .env.example .env). P0 needs no secrets.
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

If you change anything in `editor-web/`, run `npm run build:editor` (it regenerates
`src/modules/editor/generated/editorHtml.ts` and its CSP hash). `npm run verify` fails if you forget.

## Export a phase

```bash
npm run export:phase -- P0 prototype
```

Writes `exports/StudyNotesApp-P0-prototype-<YYYYMMDD>.zip`, a `.sha256` file, a contents listing and
`exports/PHASE_REPORT-P0.md` with the checksum filled in. The script refuses to include `.env`,
keystores, service-account files and anything that looks like a key.

## Folder map

```
src/app/            screens (Expo Router): home + one screen per spike, results, settings
src/core/           shared building blocks: logger, validation, document model, results log, UI kit
src/modules/        feature modules, each with a public index.ts and its own tests
  ai/               bring-your-own-key vault (Keychain/Keystore)
  editor/           TipTap WebView host, bridge protocol, WebView hardening
  export/           PDF / DOCX / print exporters behind adapters
  ink/              Skia drawing surface, palm rejection, smoothness stats
  review/           FSRS scheduler, append-only review logs, on-device self-test
  stylepacks/       13 validated style packs, pack -> CSS, bundled OFL fonts
  voice/            recording presets and session monitor, Groq Whisper adapter, WER and drift maths
src/composition/    composition root (dependency injection) and shared hooks
editor-web/         the code that runs INSIDE the editor WebView (bundled by esbuild)
scripts/            build-editor, export-phase and their tests
docs/               all documentation
```
