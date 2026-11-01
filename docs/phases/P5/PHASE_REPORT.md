# Phase report: P5 style packs and Match a look

| | |
|---|---|
| Phase | P5 reference matching and style packs (Track B, Dev Engineer) |
| Branch / PR | `phase/p5-packs` -> `main`, PR #10 |
| Zip | `{{ZIP_NAME}}` ({{ZIP_FILES}} files, {{ZIP_BYTES}} bytes) |
| SHA-256 | `{{ZIP_SHA256}}` |
| Drive | StudyNotesApp/P5-packs |
| Plan | Approved by the Lead with the ★ choices (Q1, Q2, Q4-Q9 = A). Q3 = A approved by Rey (Nov 1): photos to Groq only |

## 1. What was built
- **All 13 packs in the app** (Q1 = A): Pick your look, the Style sheet, the subject default. The pack files are
  pinned by SHA-256 (12 byte-identical to `StudyNotes_StylePacks_v3.zip`, plus Clear Read v2). A native
  **PackPicker** (swatch cards plus ONE live preview, Q9 = A) replaces one WebView per pack.
- **Every pack's fonts bundled:** 22 SIL OFL families. Gaegu, Gowun Dodum, Mochiy Pop One and Zen Maru Gothic
  ship as generated **Latin subsets** (Q2 = A): 39-74 KB instead of 2.9-7.2 MB, with pinned source SHA-256,
  `npm run build:fonts` / `check:fonts` (in `verify`), and a build check that every wanted character the source
  has is kept. This supersedes P1 PR #9's cap raise: `MAX_FONT_BASE64` is back to 3 M. Families with Reserved
  Font Names ship unchanged. **Me > Font licences** shows every notice and the OFL text.
- **Match a look** (+ sheet, Style sheet), new module `lookmatch`:
  - **Image intake (M2):** system picker or camera, 1-3 photos, caps checked before decoding, re-encode,
    pure-TS JPEG metadata strip, Skia decode, and every temp file deleted. Photos are never kept (Q5 = A).
  - **On-device analysis (M3):** OKLab colour, lighting flattened, seeded k-means palette, paper/ink/accent/
    highlighter roles, paper pattern (lined, grid, dotted, plain), line gap, margin rule, texture, up to 3
    photos by vote (Q4 = A).
  - **Pack builder (M4):** nearest built-in pack, a field-priority builder, minimal contrast repair, an 11-step
    OKLab blend slider (Q6 = A), and `ref-` ids. The output is always a pack that `validatePack` accepts.
  - **Screens (M5):** progress with Cancel; a result screen with a live preview, the slider (toward the nearest
    pack or the note's look), 7 chips, name, and Save and use on this note / subject / Just save; Your looks
    (rename, delete). Custom packs live in `store.stylePacks` (Q7 = A, synced by P2b's triggers) and are
    re-validated on every load.
  - **Optional vision pass (M6):** "Improve with AI (sends your photo to Groq)", run only after a tap.
    Groq `qwen/qwen3.8-27b`, 18+ through P3b's gate, and a separate, versioned photo consent. The answer is
    enum-only (strict zod and strict JSON schema, one re-ask) and changes only design options. Flag
    `VISION_MATCH_ENABLED` is on.
- **Maths:** `src/modules/lookmatch/MATCH_MATH.md` §1-§10, with derivations. Code comments cite it by §.

## 2. How to run it
`npm ci`, then `npm run start:go` and scan the QR code with Expo Go (docs/TESTING_ON_DEVICE.md §3-§4). Everything
in P5 runs in Expo Go. The step-by-step checks are in **§8 "P5: style packs and Match a look"** (19 steps); steps
15-19 need a free Groq key.

## 3. Tests and checks (clean install, Node 24.22.1, npm 11.19.1, Linux sandbox)
| Check | Result |
|---|---|
| `npm run verify` (check:editor, check:fonts, typecheck, lint, Jest, secretlint, audit:prod) | pass: 782 passed / 10 skipped (opt-in live AI), 73 suites; prod audit 0 |
| `npm run audit:all` | 7 low (jest's dev-only deepmerge chain, unchanged from main); 0 moderate or higher |
| `npm run bundle:check` | Android and iOS bundles build (8.9 MB each) |
| P5 tests | about 130 new: packs and fonts, JPEG strip (Pillow-made Exif/GPS/XMP fixtures), intake caps, OKLab and k-means, analysis on SYNTHETIC pages of all 13 packs, fuzz (1,000 analyses give 1,000 valid packs), blend, ids, store and cloud contract, custom packs end to end, vision gates and request shape |
| Measured on synthetic pages (not photos) | paper type and line gap 13/13; nearest pack = source 13/13; paper ΔE < 0.02; ink ΔE < 0.04; highlighters found on 8/13 |

## 4. Security review (full table: `docs/SECURITY.md` §4e)
| ID | Severity | Status |
|---|---|---|
| P5-S1 | Low | Fixed: a synced row can't replace another custom pack (the definition id must equal the row id) |
| P5-S2 | Low | Fixed: at most 200 custom packs load (sync flood) |
| P5-S3 | Info | Accepted: picker metadata trusted for the pre-decode check, with a downsampling decode as backstop |
| P5-S4 | Info | Accepted: Android CAMERA permission (asked on demand), listed for C1 and P7 |
| P5-S5 | Info | Accepted: deleting a look moves notes without a version (content unchanged) |
| P5-S6 | Low | Fixed: the font cap is back to 3 M after the subsets |

No high-severity findings are open. Photos are untrusted at every step, and so are packs (validated on save
and on load) and AI output (enums only). Keys and photos never appear in logs (tests).

## 5. Deviations from the approved plan (for the Lead)
- **Fonts:** subsets are generated base64 modules rather than TTF assets, because the GitHub tools push text
  only and the WebView needs base64 anyway.
- **Fredoka** (Blackout Gel, weight 600): its SemiBold file fills the 700 weight slot, so the editor's font
  schema didn't need to change.
- **Two merges of main** (P1, PR #9, C1; then P3b and PR #11), each recorded as a real GitHub merge commit with
  a temporary "main's version" commit before it (cb7f0cd, 6a536cd). Review the PR diff as a whole.
- **Main fix:** `eslint.config.js` lets `web/**/*.mjs` print to the console. PR #11 landed the identical change.
- The vision pass is on by default (Rey's answer to Q3), not off as first planned.

## 6. Shared files touched
- **Root:** `package.json` and `package-lock.json` (14 font packages, expo-image-picker 58.0.10,
  expo-image-manipulator 58.0.16; dev subset-font 2.9.0 plus 4 CJK font packages; scripts build:fonts and
  check:fonts), `app.json` (image-picker plugin: no photo permission, a camera string, the microphone string
  copied from expo-audio), `eslint.config.js`.
- **stylepacks:** fonts, registry, index, fontFace (cap), new swatch, PackPicker, generated/, tests.
- **ai (M6):** providers/types (`images`), openaiCompatible (image parts, Qwen settings), catalog (Groq vision,
  `models.vision`), engine (`describeImages`), index; adapters test (models field).
- **store:** new stylePacks repo, store wiring, index.
- **composition:** hooks, index, useCases (custom packs allowed), services (`randomBytes`), new customPacks and
  CustomPackLoader.
- **app:** onboarding/look, style/[id], subject-form, new, _layout, (tabs)/me (Font licences row); new match,
  looks, font-licenses.
- **scripts:** subset-fonts.mjs, lib/fontSubset.js, lib/ttfCmap.js; the routes test.
- **docs:** ARCHITECTURE, SECURITY, TESTING_ON_DEVICE, CHANGELOG, modules/stylepacks, modules/ai, new
  modules/lookmatch, new licenses/FONTS.md, phases/P5.

## 7. Known limits
- **Real photos, the speed on Hermes (budget: under 2 s for 3 photos), Skia `readPixels` in Expo Go, the
  manipulator's output on real phone photos, and a live Groq vision call are UNVERIFIED until Rey's device
  test.** Accuracy figures come from synthetic pages only.
- Very pale highlighters blend into the paper (found on 8/13 synthetic pages). The nearest pack fills the gap,
  and a chip lets the student choose.
- Source-font gaps: Gaegu has no accented letters, and Nanum Gothic (Seoul Minimal's body) has no ñ or accented
  vowels, so those characters show in a fallback font. Changing these packs' fonts is a design decision for Rey.
- The line gap is a relative mapping (the photo's scale is unknown).
- Bundled fonts grow from 7.6 MB to 9.2 MB, and the JS bundle by about 0.4 MB.

## 8. What's next
- **P2b:** the stylePacks table is already covered by its triggers. Keep `ERASED_DEFINITION` on tombstones.
- **C1 / P7:** the Photos data type (already updated by C1), and the CAMERA permission on Android.
- **P6:** export the custom packs' fonts the same way (they are built-in families).
- **Rey:** the device checklist §8 P5 and the live Groq vision check.
