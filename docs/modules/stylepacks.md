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
