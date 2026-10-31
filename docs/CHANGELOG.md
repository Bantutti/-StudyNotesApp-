# Changelog

All notable changes, one section per phase.

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
