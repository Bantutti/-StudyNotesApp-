# Phase report: P0 prototype (spike lab)

| | |
|---|---|
| Phase | P0, prototype |
| Date | 2026-11-01 (Asia/Manila) |
| Zip | `{{ZIP_NAME}}` ({{ZIP_FILES}} files, {{ZIP_BYTES}} bytes) |
| SHA-256 | `{{ZIP_SHA256}}` |

> The copy of this report **inside** the zip still shows the placeholders above, because a zip
> cannot contain its own checksum. The real values are in `exports/<zip>.sha256` and in the copy of
> this report uploaded next to the zip (`PHASE_REPORT-P0.md`).

## 1. What was built

A runnable Expo app ("P0 Spike Lab") that tests the five riskiest parts of the plan on real phones,
plus an editor spike. Each spike saves metrics to an on-device results log.

| Spike | Built | Pass rule |
|---|---|---|
| 1. Editor (TipTap in WebView) | Offline TipTap bundle, CSP-pinned, validated bridge, block ids, packs and fonts | boot < 1.5 s, load < 0.5 s, bridge p50 < 50 ms |
| 2. Export fidelity | PDF, DOCX, print from the pack's CSS with embedded fonts; A4 and Letter | all 6 visual checks ticked |
| 3. FSRS on Hermes | Golden-vector self-test, merge-order and replay checks, throughput | 8/8 golden, merge same, replay = live |
| 4. 90-min background recording | Speech preset, background mode (dev build), session monitor | 85+ min, coverage ≥ 98%, no gap > 10 s, 90 min ≤ 25 MB |
| 5. Audio timestamps | Groq Whisper words + segments, WER, tap-to-seek, tap-along drift | ordered timestamps, seek ok ≥ 80%, drift MAD < 250 ms |
| 6. Ink latency | Skia worklet ink, palm rejection modes, frame stats | ≥ 10 strokes, p95 ≤ 1.5 × p50, < 5% dropped |

Modules: core, stylepacks, editor, export, review, voice, ink, ai (auth and sync start in P2).

## 2. How to run it

```powershell
npm ci
copy .env.example .env
npm run start:go          # scan the QR code with Expo Go
```

Background recording (Android): `npm run build:android:dev`, install the APK, then
`npm run start:dev`. Full guide: `TESTING_ON_DEVICE.md` (also at the zip root).

## 3. Phase gate results

| Gate | Result |
|---|---|
| Unit tests | **121 passed / 121** in 14 suites (app: core, stylepacks, export, review, voice, ai, ink, editor, composition, scripts; web: TipTap in jsdom) |
| Type check (`tsc --noEmit`, strict) | Pass |
| Lint (`eslint . --max-warnings 0`) | Pass |
| Editor page integrity (`npm run check:editor`) | Pass: CSP hash matches the single inline script (514,213 bytes) |
| Production dependency audit | **0 vulnerabilities** |
| Full audit (incl. dev tools) | 7 low (deepmerge via Jest; dev-only, no fix exists): accepted, see SECURITY P0-S6 |
| Secret scan (secretlint + custom Groq/Google patterns) | Clean; scanner self-test caught a planted Groq key |
| Export secret checks (paths + content) | Clean (see section 6) |
| Real bundles (`expo export`, Hermes bytecode) | Android 7.3 MB `.hbc`, iOS 7.3 MB `.hbc`, assets 6.9 MB: both compile |
| Backend rules tests | Not applicable: no backend in P0 (starts P2) |
| Security review | Done: no open High or Medium (section 5) |
| Docs | README, TESTING_ON_DEVICE, ARCHITECTURE, SECURITY, 8 module docs, CHANGELOG, this report |

## 4. Clean-setup verification of TESTING_ON_DEVICE.md

Done on 2026-11-01 in a fresh Linux sandbox (Node 24.22, npm 11.19) from the exported zip, following
sections 1 and 2 exactly:

| Step | Result |
|---|---|
| Unzip to an empty folder; confirm no `.env` inside | Pass (`.env.example` only) |
| `copy .env.example .env` (Linux: `cp`) | Pass |
| `npm ci` | Pass in 31 s (install-script warnings as documented) |
| `npm run verify` | Pass: editor page up to date, types, lint, **121/121 tests**, secret scan, prod audit 0 |
| `npm run bundle:check` | Pass: Android and iOS Hermes bundles (7.3 MB each) |
| `npm run start:go` (headless) | Pass: Metro running, manifest `runtimeVersion exposdk:58.0.0` (Expo Go SDK 58), Android dev bundle served (2,331 modules, HTTP 200) |

Windows-specific parts (PowerShell `copy`, Windows Firewall prompt, `adb reverse`) could not be run
here; they are standard and written for you to follow.

**Not verifiable by me (needs your devices):** sections 3 to 5 and the on-device checklist in
section 8 (Expo Go on Android/iPhone, the Android development build, tablet and stylus, Groq
transcription). The spike verdicts come from your runs.

## 5. Security findings (summary; details in SECURITY.md section 4)

| Severity | Count | Notes |
|---|---|---|
| High | 0 | |
| Medium | 2 fixed | Paste sanitizer rewritten (inert DOM + allowlist); tooling advisories fixed via overrides |
| Low | 1 fixed, 3 accepted/open | zod JIT off in WebView (fixed); `style-src 'unsafe-inline'` (accepted P0), unencrypted recordings (P1 decision), dev-only deepmerge |
| Info | 2 | Scanner gap covered by export checks; Groq upload is consented |

## 6. Export contents check

The export script includes only source, config, docs and assets. It excludes `node_modules`, `.git`,
`.expo`, `dist*`, `exports`, `android`, `ios`, `.env*` (except `.env.example`), keystores, `.p8/.p12/
.pem/.key`, `google-services.json`, `GoogleService-Info.plist`, service-account files and build
artefacts, and it aborts if any included text file matches a private-key, Groq, Google, OpenAI,
GitHub or service-account pattern. Full file list: `exports/<zip>.contents.txt`.

## 7. Known limits

- Device results are pending: P0's purpose is your measurements (section 8 of the testing guide).
- iPhone background recording not tested (needs a paid Apple Developer account for a dev build).
- Palm rejection is per gesture: a palm landing before the pen can block that stroke (P4b).
- Touch-to-ink latency is measured indirectly (frame times, sample rate); exact latency needs a
  slow-motion video (guide section 5).
- Tap-along drift includes human reaction time; judge the spread, not the median.
- Only the P0 packs' fonts are bundled; other packs fall back to system fonts in P0.
- DOCX approximates the look (Word has no CSS): header swipes, paper lines and decorations are not drawn.
- Editor script ≈ 500 KB; if boot is slow on low-end phones, slim zod in the WebView (P1).
- Notes are not saved between app restarts (SQLite storage is P1).
- **Google Drive upload and GitHub push were not done in this session** (integrations not available
  to the agent yet). The zip is kept in `exports/`.

## 8. What is next

1. You run the device checklist (TESTING_ON_DEVICE.md section 8) and paste the results log back.
2. I write a short **P0 decisions memo**: keep/change each risky choice (WebView editor, export
   path, background recording approach, Groq timestamps, ink stack) and update the plan.
3. With your approval, **P1 core app**: SQLite (FTS5) notes and subjects, the real editor screen,
   style pack picker, Home with Due today, guest mode, and recording encryption decision.
