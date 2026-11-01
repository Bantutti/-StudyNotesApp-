/**
 * Font subsetting rules (P5, decision Q2 = A). CommonJS so the subset script
 * (scripts/subset-fonts.mjs) and Jest share one definition.
 *
 * Why: four pack fonts are Korean or Japanese families whose files hold
 * thousands of CJK glyphs (2.9 MB to 7.2 MB each). The editor WebView gets
 * fonts as base64 data and P1 caps a face at 3,000,000 base64 characters,
 * so these faces were skipped and the page fell back to a system font
 * (this hit Gaegu, the DEFAULT pack's header font). We keep only the Latin
 * glyphs NotedPo's Philippines-first users type, which brings each face
 * to 39-74 KB.
 *
 * Licence: all four are SIL OFL 1.1 with NO Reserved Font Name (checked
 * in each package's LICENSE_FONT on 2026-11-01), so a subset may keep the
 * family name (OFL condition 3 applies only to Reserved Font Names).
 * Nanum Gothic DOES declare Reserved Font Names, so it is never subset and
 * ships unchanged (about 2 MB per weight, under the cap).
 *
 * Text outside the subset (for example Korean in Seoul Minimal) still
 * renders: the browser falls back to the next font in the CSS stack.
 */
'use strict';

/** Unicode ranges kept, inclusive. Codepoints a font doesn't have are skipped by the subsetter. */
const SUBSET_RANGES = [
  [0x0020, 0x007e], // Basic Latin (ASCII)
  [0x00a0, 0x00ff], // Latin-1 Supplement: ñ Ñ é ° ± × ÷ « » ¿ ¡
  [0x0100, 0x017f], // Latin Extended-A (names in Spanish-era and other European spellings)
  [0x0391, 0x03a9], // Greek capitals (STEM notes)
  [0x03b1, 0x03c9], // Greek small letters
  [0x2010, 0x2027], // dashes, quotes, bullet, ellipsis
  [0x2030, 0x203a], // per mille, primes, single guillemets
  [0x20ac, 0x20ac], // euro
  [0x20b1, 0x20b1], // peso sign ₱
  [0x2122, 0x2122], // trade mark
  [0x2190, 0x2193], // arrows ← ↑ → ↓
  [0x2212, 0x2212], // minus
  [0x2248, 0x2248], // almost equal
  [0x2260, 0x2260], // not equal
  [0x2264, 0x2265], // less/greater or equal
];

/**
 * Characters we care about for Filipino study notes. The build requires
 * every subset to keep all of them THAT ITS SOURCE FONT HAS (plus all of the
 * ASCII part unconditionally). Some sources simply lack some: Gaegu has no
 * accented letters, and many fonts have no peso sign; those characters
 * render in the fallback font, as they did before subsetting. A coverage
 * report test lists which pack fonts lack which (docs/modules/stylepacks.md).
 */
const REQUIRED_TEXT =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  ' .,;:!?\'"()[]-_/&%+=*#@' +
  'ñÑ₱';

/** All codepoints of SUBSET_RANGES as one string (the subsetter's input). */
function subsetText() {
  let s = '';
  for (const [a, b] of SUBSET_RANGES) for (let c = a; c <= b; c++) s += String.fromCodePoint(c);
  return s;
}

/**
 * Faces we subset. `sha256` pins the exact source file inside the pinned npm
 * package (package-lock.json pins the package; this pins the file), so a
 * changed upstream file fails the build instead of silently changing glyphs.
 * `weight` is the CSS weight slot the face fills (400 or 700).
 */
const SUBSET_FACES = [
  {
    id: 'Gaegu_400Regular', family: 'Gaegu', weight: 400, style: 'normal',
    source: '@expo-google-fonts/gaegu/400Regular/Gaegu_400Regular.ttf',
    sha256: '9de068b26e04a0b4b0dd8e79ff8ad26907306ff602b7169fc2dda2e4b1fb885b',
  },
  {
    id: 'Gaegu_700Bold', family: 'Gaegu', weight: 700, style: 'normal',
    source: '@expo-google-fonts/gaegu/700Bold/Gaegu_700Bold.ttf',
    sha256: 'e48f58ff3e4163f5a8163de982556b0c4343e4e3b5584df2d14f79737fca60ae',
  },
  {
    id: 'GowunDodum_400Regular', family: 'Gowun Dodum', weight: 400, style: 'normal',
    source: '@expo-google-fonts/gowun-dodum/400Regular/GowunDodum_400Regular.ttf',
    sha256: 'e7df7279df4649cd452d0f110ad4b825653c0d1a3baf6fa61c7bce99d88b281a',
  },
  {
    id: 'MochiyPopOne_400Regular', family: 'Mochiy Pop One', weight: 400, style: 'normal',
    source: '@expo-google-fonts/mochiy-pop-one/400Regular/MochiyPopOne_400Regular.ttf',
    sha256: '804216a2fc04a905af594e2a7514a9bfc55a4276f3c5160ec487d55227669a4d',
  },
  {
    id: 'ZenMaruGothic_400Regular', family: 'Zen Maru Gothic', weight: 400, style: 'normal',
    source: '@expo-google-fonts/zen-maru-gothic/400Regular/ZenMaruGothic_400Regular.ttf',
    sha256: 'd1e5d9a182b5a6a64609ce237a3d44cd9a7eee588b74893b3ebe2c90caaac11d',
  },
  {
    id: 'ZenMaruGothic_700Bold', family: 'Zen Maru Gothic', weight: 700, style: 'normal',
    source: '@expo-google-fonts/zen-maru-gothic/700Bold/ZenMaruGothic_700Bold.ttf',
    sha256: 'd726be217b3039398300c0e1c5991119e78e54af56b0b53423769479493128a7',
  },
];

/** Families with Reserved Font Names: never subset or renamed (OFL condition 3). */
const NEVER_SUBSET = ['Nanum Gothic', 'Dancing Script', 'Delius', 'Delius Swash Caps', 'Lexend', 'Quicksand'];

/** Family -> @expo-google-fonts package folder, for the licence notices (every bundled family). */
const FAMILY_PACKAGES = {
  'Atkinson Hyperlegible': 'atkinson-hyperlegible',
  Caveat: 'caveat',
  Cinzel: 'cinzel',
  'Cormorant Garamond': 'cormorant-garamond',
  'Crimson Pro': 'crimson-pro',
  'Dancing Script': 'dancing-script',
  Delius: 'delius',
  'Delius Swash Caps': 'delius-swash-caps',
  'EB Garamond': 'eb-garamond',
  Fredoka: 'fredoka',
  Gaegu: 'gaegu',
  'Gowun Dodum': 'gowun-dodum',
  Itim: 'itim',
  Kalam: 'kalam',
  Lexend: 'lexend',
  'Mochiy Pop One': 'mochiy-pop-one',
  Mulish: 'mulish',
  'Nanum Gothic': 'nanum-gothic',
  Nunito: 'nunito',
  'Patrick Hand': 'patrick-hand',
  Quicksand: 'quicksand',
  'Zen Maru Gothic': 'zen-maru-gothic',
};

module.exports = { SUBSET_RANGES, REQUIRED_TEXT, subsetText, SUBSET_FACES, NEVER_SUBSET, FAMILY_PACKAGES };
