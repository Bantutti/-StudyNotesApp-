/**
 * Bundled font files (SIL OFL, via @expo-google-fonts) and @font-face CSS.
 * Bundled: the P0 packs' four families plus Atkinson Hyperlegible (P1, Clear
 * Read). Other packs' fonts fall back to system fonts until P5 bundles them.
 */
// Deep imports: each package's index would bundle every weight (~2 MB of TTFs).
import { AtkinsonHyperlegible_400Regular } from '@expo-google-fonts/atkinson-hyperlegible/400Regular';
import { AtkinsonHyperlegible_400Regular_Italic } from '@expo-google-fonts/atkinson-hyperlegible/400Regular_Italic';
import { AtkinsonHyperlegible_700Bold } from '@expo-google-fonts/atkinson-hyperlegible/700Bold';
import { Cinzel_400Regular } from '@expo-google-fonts/cinzel/400Regular';
import { Cinzel_700Bold } from '@expo-google-fonts/cinzel/700Bold';
import { CrimsonPro_400Regular } from '@expo-google-fonts/crimson-pro/400Regular';
import { CrimsonPro_400Regular_Italic } from '@expo-google-fonts/crimson-pro/400Regular_Italic';
import { CrimsonPro_700Bold } from '@expo-google-fonts/crimson-pro/700Bold';
import { Gaegu_400Regular } from '@expo-google-fonts/gaegu/400Regular';
import { Gaegu_700Bold } from '@expo-google-fonts/gaegu/700Bold';
import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular';
import { Nunito_400Regular_Italic } from '@expo-google-fonts/nunito/400Regular_Italic';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';

import { BASE64_PATTERN } from '@/core';

import { MAX_FONT_BASE64, type FontFaceData } from './fontFace';
import type { FontFamily, StylePack } from './schema';

export interface FontFaceAsset {
  family: FontFamily;
  weight: 400 | 700;
  style: 'normal' | 'italic';
  /** Metro asset id from require(). */
  asset: number;
}

export const BUNDLED_FACES: readonly FontFaceAsset[] = [
  { family: 'Gaegu', weight: 400, style: 'normal', asset: Gaegu_400Regular },
  { family: 'Gaegu', weight: 700, style: 'normal', asset: Gaegu_700Bold },
  { family: 'Nunito', weight: 400, style: 'normal', asset: Nunito_400Regular },
  { family: 'Nunito', weight: 400, style: 'italic', asset: Nunito_400Regular_Italic },
  { family: 'Nunito', weight: 700, style: 'normal', asset: Nunito_700Bold },
  { family: 'Cinzel', weight: 400, style: 'normal', asset: Cinzel_400Regular },
  { family: 'Cinzel', weight: 700, style: 'normal', asset: Cinzel_700Bold },
  { family: 'Crimson Pro', weight: 400, style: 'normal', asset: CrimsonPro_400Regular },
  { family: 'Crimson Pro', weight: 400, style: 'italic', asset: CrimsonPro_400Regular_Italic },
  { family: 'Crimson Pro', weight: 700, style: 'normal', asset: CrimsonPro_700Bold },
  // P1: Clear Read (high-legibility pack, decision Q1)
  { family: 'Atkinson Hyperlegible', weight: 400, style: 'normal', asset: AtkinsonHyperlegible_400Regular },
  { family: 'Atkinson Hyperlegible', weight: 400, style: 'italic', asset: AtkinsonHyperlegible_400Regular_Italic },
  { family: 'Atkinson Hyperlegible', weight: 700, style: 'normal', asset: AtkinsonHyperlegible_700Bold },
];

export function facesForPack(p: StylePack): FontFaceAsset[] {
  const families = new Set<FontFamily>([p.fonts.header, p.fonts.body]);
  return BUNDLED_FACES.filter((f) => families.has(f.family));
}

export function missingFamilies(p: StylePack): FontFamily[] {
  const bundled = new Set(BUNDLED_FACES.map((f) => f.family));
  return [p.fonts.header, p.fonts.body].filter((f) => !bundled.has(f));
}

/** Port for reading a bundled asset as base64 (Expo adapter in fontLoader). */
export type AssetReader = (asset: number) => Promise<string>;

export async function loadFaces(p: StylePack, read: AssetReader): Promise<FontFaceData[]> {
  const out: FontFaceData[] = [];
  for (const f of facesForPack(p)) {
    const base64 = await read(f.asset);
    if (base64.length > MAX_FONT_BASE64 || !BASE64_PATTERN.test(base64)) continue; // skip, never inject
    out.push({ family: f.family, weight: f.weight, style: f.style, base64 });
  }
  return out;
}
