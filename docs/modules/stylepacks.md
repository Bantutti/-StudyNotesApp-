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
