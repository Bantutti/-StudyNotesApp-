/**
 * Nearest built-in pack to an analysis (MATCH_MATH.md §7). The nearest pack
 * fills every field the photo can't tell us (fonts, header and block styles,
 * decorations, highlighter meanings) and is the slider's far end (Q6 = A).
 */
import { composite, type StylePack } from '@/modules/stylepacks';

import type { LookAnalysis } from '../analysis/analyze';
import { deltaE, hexToLab } from '../color/oklab';

/** §7.1 weights. Paper dominates what a page "looks like"; categorical mismatches are penalties. */
export const NEAREST_WEIGHTS = {
  paper: 3,
  ink: 1,
  accent: 1.5,
  highlighters: 1,
  appearance: 2,
  paperType: 0.25,
  margin: 0.08,
  texture: 0.05,
} as const;

const dE = (x: string, y: string) => deltaE(hexToLab(x), hexToLab(y));

/**
 * §7.2 highlighter term: for each highlighter seen in the photo, the
 * distance to the closest highlighter of the pack (both as they look on
 * paper), averaged. 0 when the photo shows none.
 */
function highlighterDistance(a: LookAnalysis, p: StylePack): number {
  if (a.highlighters.length === 0) return 0;
  // Pack highlighters as they look on its paper (the validator's sRGB composite, §4.3).
  const onPaper = p.highlighters.map((h) => composite(h.color, p.paper.color, h.opacity));
  const ds = a.highlighters.map((h) => Math.min(...onPaper.map((c) => dE(h.seen, c))));
  return ds.reduce((s, d) => s + d, 0) / ds.length;
}

/** §7.1 distance: a weighted sum of colour distances plus categorical penalties. Lower is closer. */
export function packDistance(a: LookAnalysis, p: StylePack): number {
  const w = NEAREST_WEIGHTS;
  let d = w.paper * dE(a.paper.color, p.paper.color) + w.ink * dE(a.ink, p.palette.ink);
  if (a.accent) d += w.accent * dE(a.accent, p.palette.accent);
  d += w.highlighters * highlighterDistance(a, p);
  if (a.appearance !== p.meta.appearance) d += w.appearance;
  if (a.paper.type !== p.paper.type) d += w.paperType;
  if (a.paper.margin !== p.paper.margin) d += w.margin;
  if (a.paper.texture !== p.paper.texture) d += w.texture;
  return d;
}

/** Built-in packs sorted from nearest to farthest. */
export function rankPacks(a: LookAnalysis, packs: readonly StylePack[]): { pack: StylePack; distance: number }[] {
  return packs
    .map((pack) => ({ pack, distance: packDistance(a, pack) }))
    .sort((x, y) => x.distance - y.distance || x.pack.id.localeCompare(y.pack.id));
}
