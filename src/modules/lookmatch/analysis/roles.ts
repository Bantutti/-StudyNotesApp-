/**
 * Colour roles: which palette colour is the paper, the ink, the accent and
 * the highlighters (MATCH_MATH.md §4).
 *
 * The clusters come from k-means (§3) on the flattened image (§2), sorted
 * by weight. All rules below are simple and explainable on purpose: the
 * student sees the result as chips and can change any of them.
 */
import { chroma, deltaE, hexToRgb, hue, labToHex, rgbToHex, rgbToLab, type Lab } from '../color/oklab';

import type { Cluster } from './kmeans';

export interface HighlighterGuess {
  /** The pen colour BEFORE it is laid over the paper (§4.3). */
  color: string;
  opacity: number;
  /** What the photo actually shows (pen over paper), for the chip swatch. */
  seen: string;
  weight: number;
}

export interface RoleGuess {
  appearance: 'light' | 'dark';
  paper: string;
  ink: string;
  /** Header colour; null when the photo has no clearly coloured ink (§4.4). */
  accent: string | null;
  accent2: string | null;
  highlighters: HighlighterGuess[];
  /** Every cluster as a swatch for the palette chip, largest first. */
  swatches: { hex: string; weight: number }[];
}

/** Clusters smaller than this are noise (a stray pixel colour), §4. */
const MIN_WEIGHT = 0.003;
/** Chroma above which a colour counts as "coloured" rather than grey (§1.4). */
const COLOURED = 0.05;
/** A highlighter's lightness is within this of the paper's (§4.3): it tints the paper, it doesn't cover it like ink. */
const HL_MAX_DL = 0.22;
/** A highlighter is at least this much more chromatic than the paper (§4.3). */
const HL_MIN_EXTRA_CHROMA = 0.025;
/** Two highlighters (and a highlighter and the paper) must differ by at least this (§1.3). */
const HL_MIN_APART = 0.06;
/** Highlighter opacity we solve for first (§4.3); packs use 0.25..1. */
const HL_OPACITY = 0.6;

/**
 * §4.3: the photo shows the composite c_seen = alpha * c_pen + (1 - alpha) * paper
 * (per sRGB channel, the same blend stylepacks' composite() uses). Solving
 * for the pen colour: c_pen = (c_seen - (1 - alpha) * paper) / alpha. If a
 * channel leaves 0..255 the pen would need to be "more than full colour",
 * so alpha is raised in steps until it fits (alpha = 1 always fits:
 * c_pen = c_seen).
 */
export function unblendHighlighter(seenHex: string, paperHex: string): { color: string; opacity: number } {
  const seen = hexToRgb(seenHex);
  const paper = hexToRgb(paperHex);
  for (let alpha = HL_OPACITY; alpha <= 1.0001; alpha += 0.05) {
    const pen = seen.map((c, i) => (c - (1 - alpha) * (paper[i] as number)) / alpha);
    if (pen.every((v) => v >= 0 && v <= 255)) {
      return { color: rgbToHex(pen as [number, number, number]), opacity: Math.round(Math.min(1, alpha) * 100) / 100 };
    }
  }
  return { color: seenHex, opacity: 1 };
}

/** Hue distance on the colour wheel, 0..180 degrees. */
const hueGap = (x: Lab, y: Lab) => {
  const d = Math.abs(hue(x) - hue(y)) % 360;
  return d > 180 ? 360 - d : d;
};

/** Clusters this close (§1.3) to a known pattern or margin colour are that pattern, not a role (§4.5). */
const EXCLUDE_WITHIN = 0.05;
/** Pattern colours differ from the paper by less than this in L (§4.5). */
const PATTERN_MAX_DL = 0.3;

/**
 * §4. `exclude` holds colours the pattern pass already explained (ruling,
 * dots, margin rule, §5.7): a pale blue ruled line is not a highlighter,
 * and a red margin rule is not the header colour.
 */
export interface Exclusions {
  /** Faint printed pattern (ruling, grid, dots): excluded only when it is close to the paper in L. */
  pattern?: string | null;
  /** Margin rule: excluded whatever its strength (margin rules are deliberately strong colours). */
  margin?: string | null;
}

export function assignRoles(clustersIn: readonly Cluster[], exclude: Exclusions = {}): RoleGuess {
  const pat = exclude.pattern ? rgbToLabHex(exclude.pattern) : null;
  const mar = exclude.margin ? rgbToLabHex(exclude.margin) : null;
  const all = clustersIn.filter((c) => c.weight >= MIN_WEIGHT);
  if (all.length === 0) throw new Error('no_colours');
  // The paper (largest cluster) is never excluded, and neither is a colour that stands far from
  // the paper in lightness: printed patterns are faint, so a strong colour is ink, not a pattern.
  const paperL0 = (all[0] as Cluster).center.L;
  const clusters = all.filter((c, i) => {
    if (i === 0) return true;
    if (mar && deltaE(mar, c.center) < EXCLUDE_WITHIN) return false;
    if (pat && Math.abs(c.center.L - paperL0) < PATTERN_MAX_DL && deltaE(pat, c.center) < EXCLUDE_WITHIN) return false;
    return true;
  });

  // §4.1 paper: the biggest cluster. Note pages are mostly paper, and the
  // lighting was flattened (§2.2), so the paper is one big cluster.
  const paperC = clusters[0] as Cluster;
  const paper = paperC.center;
  const appearance: 'light' | 'dark' = paper.L >= 0.5 ? 'light' : 'dark';
  const rest = clusters.slice(1);

  // §4.2 ink: the colour most different in LIGHTNESS from the paper, with a
  // small bonus for being grey (pens are usually black, blue-black or
  // white gel) and for being common (body text is the second biggest thing).
  const inkScore = (c: Cluster) => Math.abs(c.center.L - paper.L) - 0.5 * chroma(c.center) + 0.5 * Math.min(0.2, c.weight);
  const inkC = [...rest].sort((x, y) => inkScore(y) - inkScore(x))[0];
  // A blank page (only paper): fall back to black or white ink for the appearance.
  const ink: Lab = inkC?.center ?? (appearance === 'light' ? { L: 0.2, a: 0, b: 0 } : { L: 0.93, a: 0, b: 0 });

  // §4.3 highlighters: coloured, close to the paper in lightness, not the ink.
  // Relative to the paper: a highlighter is clearly more colourful than the paper and visibly different (§4.3).
  const hlCandidates = rest
    .filter(
      (c) =>
        c !== inkC &&
        chroma(c.center) >= chroma(paper) + HL_MIN_EXTRA_CHROMA &&
        deltaE(c.center, paper) >= HL_MIN_APART &&
        Math.abs(c.center.L - paper.L) <= HL_MAX_DL,
    )
    .sort((x, y) => y.weight - x.weight);
  const highlighters: HighlighterGuess[] = [];
  const paperHex = labToHex(paper);
  for (const c of hlCandidates) {
    if (highlighters.length >= 4) break;
    if (highlighters.some((h) => deltaE(rgbToLabHex(h.seen), c.center) < HL_MIN_APART)) continue;
    const seen = labToHex(c.center);
    highlighters.push({ ...unblendHighlighter(seen, paperHex), seen, weight: c.weight });
  }

  // §4.4 accent: the most coloured remaining cluster that stands away from
  // the paper in lightness (a header or coloured pen, not a tint).
  const used = new Set<Cluster>([paperC, ...(inkC ? [inkC] : []), ...hlCandidates]);
  const accentCandidates = rest
    .filter((c) => !used.has(c) && chroma(c.center) >= COLOURED && Math.abs(c.center.L - paper.L) > HL_MAX_DL * 0.6)
    .sort((x, y) => chroma(y.center) * Math.sqrt(y.weight) - chroma(x.center) * Math.sqrt(x.weight));
  const accentC = accentCandidates[0] ?? null;
  // accent2: a second accent with a clearly different hue (>= 40 degrees), else null.
  const accent2C = accentC ? (accentCandidates.find((c) => c !== accentC && hueGap(c.center, accentC.center) >= 40) ?? null) : null;

  return {
    appearance,
    paper: paperHex,
    ink: labToHex(ink),
    accent: accentC ? labToHex(accentC.center) : null,
    accent2: accent2C ? labToHex(accent2C.center) : null,
    highlighters,
    swatches: clusters.map((c) => ({ hex: labToHex(c.center), weight: Math.round(c.weight * 1000) / 1000 })),
  };
}

function rgbToLabHex(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}
