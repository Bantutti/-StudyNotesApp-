/**
 * The "closer to your photo / closer to <pack>" slider (MATCH_MATH.md §9,
 * decision Q6 = A). t = 0 is the matched look, t = 1 the target pack
 * (nearest built-in by default, or the note's current pack via the chip).
 *
 * Every step is a complete pack: colours blend in OKLab (§9.1), numbers
 * interpolate and are clamped and rounded to what the schema allows
 * (§9.2), and choices (enums, fonts, booleans) switch at the midpoint
 * (§9.3). Each step is contrast-repaired and validated (finalize), so the
 * slider can never produce an invalid pack.
 */
import type { StylePack } from '@/modules/stylepacks';

import { hexToLab, mixHexOklab } from '../color/oklab';

import { finalize } from './builder';

/** Number of slider positions (0, 0.1, ..., 1). */
export const BLEND_STEPS = 11;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** §9.3 discrete fields: the matched side until the midpoint, then the target. */
const pick = <T,>(a: T, b: T, t: number): T => (t < 0.5 ? a : b);

export function blendPacks(matched: StylePack, target: StylePack, tIn: number): StylePack {
  const t = clamp(Number.isFinite(tIn) ? tIn : 0, 0, 1);
  if (t === 0) return finalize(matched);
  const col = (a: string, b: string) => mixHexOklab(a, b, t);
  const side = t < 0.5 ? matched : target;
  const other = t < 0.5 ? target : matched;

  // §9.4 highlighters: as many as the side that "wins" at t; each blended with the
  // other side's highlighter at the same position when there is one.
  const highlighters = side.highlighters.map((h, i) => {
    const o = other.highlighters[i];
    if (!o) return { ...h };
    const [m, g] = t < 0.5 ? [h, o] : [o, h];
    return { id: h.id, meaning: h.meaning, color: col(m.color, g.color), opacity: Math.round(clamp(lerp(m.opacity, g.opacity, t), 0.25, 1) * 100) / 100 };
  });

  const paperColor = col(matched.paper.color, target.paper.color);
  const out: StylePack = {
    schema: 3,
    id: matched.id,
    version: matched.version,
    name: matched.name,
    meta: { ...matched.meta, appearance: hexToLab(paperColor).L >= 0.5 ? 'light' : 'dark' },
    paper: {
      type: pick(matched.paper.type, target.paper.type, t),
      color: paperColor,
      line: col(matched.paper.line, target.paper.line),
      lineGap: Math.round(clamp(lerp(matched.paper.lineGap, target.paper.lineGap, t), 22, 34)),
      margin: pick(matched.paper.margin, target.paper.margin, t),
      texture: pick(matched.paper.texture, target.paper.texture, t),
    },
    fonts: {
      header: pick(matched.fonts.header, target.fonts.header, t),
      body: pick(matched.fonts.body, target.fonts.body, t),
      // Weight and style belong to the chosen font, so they switch with it.
      headerWeight: pick(matched.fonts.headerWeight, target.fonts.headerWeight, t),
      headerItalic: pick(matched.fonts.headerItalic, target.fonts.headerItalic, t),
      headerCase: pick(matched.fonts.headerCase, target.fonts.headerCase, t),
      headerScale: Math.round(clamp(lerp(matched.fonts.headerScale, target.fonts.headerScale, t), 1.5, 2.8) * 100) / 100,
      bodySize: pick(matched.fonts.bodySize, target.fonts.bodySize, t),
    },
    palette: {
      ink: col(matched.palette.ink, target.palette.ink),
      accent: col(matched.palette.accent, target.palette.accent),
      accent2: col(matched.palette.accent2, target.palette.accent2),
      muted: col(matched.palette.muted, target.palette.muted),
      soft: col(matched.palette.soft, target.palette.soft),
    },
    highlighters,
    highlightKey: { ...side.highlightKey },
    header: { style: pick(matched.header.style, target.header.style, t), divider: pick(matched.header.divider, target.header.divider, t) },
    blocks: { ...side.blocks },
    decor: { ...side.decor },
    ink: {
      pens: matched.ink.pens.map((p, i) => col(p, target.ink.pens[i] as string)) as StylePack['ink']['pens'],
      highlighter: (highlighters[0] as { color: string }).color,
    },
    layout: { columns: pick(matched.layout.columns, target.layout.columns, t), margin: pick(matched.layout.margin, target.layout.margin, t) },
  };
  // A highlight key that shows meanings needs every meaning non-empty (validator cross-check).
  return finalize(out);
}

/** All slider positions, for previews and tests. */
export function blendSteps(matched: StylePack, target: StylePack): StylePack[] {
  return Array.from({ length: BLEND_STEPS }, (_, i) => blendPacks(matched, target, i / (BLEND_STEPS - 1)));
}
