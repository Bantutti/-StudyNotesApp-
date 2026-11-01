/**
 * Contrast repair (MATCH_MATH.md §8): make a candidate pack pass every
 * schema v3 contrast rule by the SMALLEST change, keeping each colour's
 * hue. The validator (stylepacks validatePack) stays the judge: repair only
 * proposes, then the pack is validated as usual.
 *
 * Rules (stylepacks validate.ts): ink on paper, ink on the callout fill
 * (soft) and ink on every highlighter composited over the paper: 4.5:1;
 * muted on paper 4.5:1; accent, accent2 and each pen on paper: 3:1.
 */
import { composite, contrast, type StylePack } from '@/modules/stylepacks';

import { hexToLab, labToHex, mixHexOklab, type Lab } from '../color/oklab';

/** Aim slightly above each minimum so rounding to #RRGGBB can't drop a colour back under it (§8.1). */
export const REPAIR_MARGIN = 1.03;

/**
 * §8.1 lightness nudge: move fg's OKLab L toward 0 or 1 (keeping a and b,
 * gamut-mapped) by bisection until contrast(fg, bg) >= min * margin. The
 * direction is the one whose extreme reaches the target; darker first on
 * light backgrounds. Returns fg unchanged when it already passes.
 */
export function nudgeLightness(fg: string, bg: string, min: number): string {
  const target = min * REPAIR_MARGIN;
  if (contrast(fg, bg) >= target) return fg;
  const lab = hexToLab(fg);
  const at = (L: number): string => labToHex({ L, a: lab.a, b: lab.b } satisfies Lab);
  const bgLab = hexToLab(bg);
  const dirs = bgLab.L >= 0.6 ? [0, 1] : [1, 0];
  for (const end of dirs) {
    if (contrast(at(end), bg) < target) continue;
    let near = lab.L; // fails
    let far = end; // passes
    for (let i = 0; i < 30; i++) {
      const mid = (near + far) / 2;
      if (contrast(at(mid), bg) >= target) far = mid;
      else near = mid;
    }
    return at(far);
  }
  // Neither extreme reaches the target (only possible for impossible minimums): pure black or white.
  return contrast('#000000', bg) >= contrast('#FFFFFF', bg) ? '#000000' : '#FFFFFF';
}

/**
 * §8.2 toward-paper fix for FILLS (callout fill, highlighters): text sits on
 * them, so instead of changing the ink again we move the fill toward the
 * paper colour, the smallest t in [0, 1] that passes. t = 1 is the paper
 * itself, which passes because ink-on-paper was fixed first.
 */
function towardPaper(fill: string, paper: string, passes: (c: string) => boolean): string {
  if (passes(fill)) return fill;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (passes(mixHexOklab(fill, paper, mid))) hi = mid;
    else lo = mid;
  }
  return mixHexOklab(fill, paper, hi);
}

/** §8.3 order: paper is fixed; ink first, then the fills under the ink, then everything else on paper. */
export function repairContrast(p: StylePack): StylePack {
  const out: StylePack = JSON.parse(JSON.stringify(p)) as StylePack;
  const paper = out.paper.color;
  const T = 4.5 * REPAIR_MARGIN;
  out.palette.ink = nudgeLightness(out.palette.ink, paper, 4.5);
  const ink = out.palette.ink;
  out.palette.soft = towardPaper(out.palette.soft, paper, (c) => contrast(ink, c) >= T);
  out.highlighters = out.highlighters.map((h) => {
    // Lower opacity first (keeps the pen's colour), down to the schema minimum, then move the pen toward paper.
    let opacity = h.opacity;
    while (opacity > 0.25 && contrast(ink, composite(h.color, paper, opacity)) < T) opacity = Math.max(0.25, Math.round((opacity - 0.05) * 100) / 100);
    const color = towardPaper(h.color, paper, (c) => contrast(ink, composite(c, paper, opacity)) >= T);
    return { ...h, color, opacity };
  });
  out.palette.muted = nudgeLightness(out.palette.muted, paper, 4.5);
  out.palette.accent = nudgeLightness(out.palette.accent, paper, 3);
  out.palette.accent2 = nudgeLightness(out.palette.accent2, paper, 3);
  out.ink.pens = out.ink.pens.map((pen) => nudgeLightness(pen, paper, 3)) as StylePack['ink']['pens'];
  return out;
}
