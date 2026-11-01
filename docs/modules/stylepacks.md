# stylepacks

**Purpose:** style packs as validated data (schema v3) turned into CSS for the editor and exports,
plus bundled OFL fonts. 13 packs bundled; default `pastel-highlight`; P0 spikes use Pastel
Highlight (light) and Dark Academia (dark).

**Public interface**
- `stylePackSchema`, `StylePack`, `FONTS`, `ENUMS`
- `validatePack(raw) -> { ok, pack, errors, contrast }`, `contrastChecks(pack)`
- `packCss(pack)` (CSS variables + static `BASE_CSS`), `packVars`, `packAttrs`, `highlighterColor`
- `cornerSvg`, `doodleSvg` (export-only decorations)
- `createPackRegistry()`, `DEFAULT_PACK_ID`, `P0_PACK_IDS`
- Fonts: `BUNDLED_FACES`, `facesForPack`, `missingFamilies`, `loadFaces(pack, reader)`,
  `fontFaceCss`, `fontFaceDataSchema`, `expoAssetReader`
- `web.ts`: Expo-free subset used by the editor WebView bundle.

**How to extend**
- New pack: add `packs/<id>.json`, import it in `registry.ts`. The stylepacks test fails if it
  breaks a schema or contrast rule.
- New font: add the family to `FONTS` (must be SIL OFL), add deep imports of the needed weights to
  `fonts.ts` (`@expo-google-fonts/<family>/<weight>`); never import a font package's index (it
  bundles every weight).
- New component style: add a data-attribute rule to `BASE_CSS`; never let a pack carry CSS.

## P1 changes (M9)
- **Packs in the app:** `P1_PACK_IDS = ['pastel-highlight', 'clear-read']` (decision Q1). The other 11
  packs stay in the registry for P5.
- **Clear Read v2:** 4 highlighters with the same meanings and order as Pastel Highlight (Key idea,
  Definition, Example, Formula), so a note's highlights keep their meaning when it switches look.
  Colours: yellow, blue, peach and lilac (told apart by colour-blind readers), all at least 7:1 with the
  ink (tested).
- **Atkinson Hyperlegible** (SIL OFL 1.1) is bundled: regular, italic and bold, via
  `@expo-google-fonts/atkinson-hyperlegible` 0.4.1 (deep imports, so only those three files ship).
- **Style sheet** (`/style/[id]`): every look rendered on the student's own note; tap to apply
  (`applyPackToNote` saves a "Before style change" version; content and block ids never change), use for
  the subject, use for new notes, add a template.

## P5 changes (M1: packs and fonts)
- **All 13 packs in the app** (P5 decision Q1 = A): `V1_PACK_IDS` (10 launch packs, then Ocean Lines,
  Peach Grid, Chalkboard). `isBuiltInPackId`, `isCustomPackId`. `P1_PACK_IDS` is kept for old callers only.
  The pack JSON files are pinned by SHA-256 in `__tests__/v1packs.test.ts`: 12 are byte-identical to
  `StudyNotes_StylePacks_v3.zip`, and Clear Read is P1's v2.
- **Custom packs** ("Match a look"): ids are `ref-` + 20 lowercase base32 characters (`CUSTOM_PACK_ID`, 100
  random bits), valid both as a pack id and as a P2a entity id. `registry.setCustom(raw[])` validates every
  entry with `validatePack` (schema + contrast) and drops anything invalid, including a custom pack that
  tries to reuse a built-in id. `subscribe`/`revision` let screens re-render (`usePackList`, `usePackFaces`).
- **Every pack's fonts are bundled** (22 families, all SIL OFL 1.1). `BUNDLED_FACES` rows have a `source`:
  `asset` (a TTF from a pinned `@expo-google-fonts` package, deep import) or `inline` (a generated base64
  subset). A test checks every pack has its header face (in the right weight slot and style) and a regular
  body face, and that every face fits under `MAX_FONT_BASE64`.
- **Latin subsets** (P5 decision Q2 = A) for the four Korean/Japanese families whose full files exceed the
  3,000,000-character base64 cap: Gaegu (both weights), Gowun Dodum, Mochiy Pop One, Zen Maru Gothic
  (2.9-7.2 MB each, 39-74 KB after subsetting). **This fixes a P1 bug:** Gaegu (Pastel Highlight's header,
  the default pack) was 4.22M / 3.95M base64 characters, so `loadFaces` skipped it and headers fell back to a
  system font. Rebuild with `npm run build:fonts`; `npm run check:fonts` (in `verify`) fails if the
  committed files are stale. Rules in `scripts/lib/fontSubset.js`: pinned source SHA-256 per face, the
  kept Unicode ranges, and a build check that the subset keeps EVERY wanted character its source has.
- **Reserved Font Names:** Nanum Gothic, Dancing Script, Delius, Delius Swash Caps, Lexend and Quicksand
  declare them, so they ship unchanged (OFL condition 3). The build refuses to subset them.
- **Known glyph gaps in the source fonts** (not caused by subsetting; pinned by a test): Gaegu has no
  accented letters (ñ, é...), en dash, bullet or ellipsis, and Nanum Gothic (Seoul Minimal's body) has no
  ñ or accented vowels. Those characters render in the fallback font. Many fonts lack ₱.
- **Fredoka** (Blackout Gel header, weight 600): the SemiBold file fills the 700 weight slot, because
  `fontFaceDataSchema` allows 400 and 700 only and CSS picks the 700 face for weight 600.
- **Font licences:** `FONT_NOTICES` and `OFL_TEXT` (generated from each package's `LICENSE_FONT`) back the
  new Me > Font licences screen (`/font-licenses`); `docs/licenses/FONTS.md` is the same list on GitHub.
- **PackPicker** (P5 decision Q9 = A): a native grid of swatch cards (`swatchModel`, `PackSwatch`) with one
  live page preview above it, used by Pick your look and the Style sheet. This replaces one WebView per pack.
- **Size:** bundled fonts grow from 7.6 MB (P1, mostly the two full Gaegu files) to 9.2 MB for all 13 packs;
  the JS bundle grows about 0.4 MB (the inline subsets).
