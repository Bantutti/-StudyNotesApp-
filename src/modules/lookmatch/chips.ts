/**
 * The "what we matched" chips on the result screen (plan F4: "chips ...
 * each tappable to change"). Pure data: the options each chip offers.
 *
 * Every option is a value the schema allows: colours are #RRGGBB taken from
 * the photo's own palette or the nearest pack (no free colour entry), fonts
 * are pairings that a built-in pack already uses (so they are bundled and
 * known to work together), and styles are schema enums. Contrast is still
 * repaired after any choice (§8), so a chip can't produce an unreadable pack.
 */
import { ENUMS, type StylePack } from '@/modules/stylepacks';

import type { LookAnalysis } from './analysis/analyze';
import { chroma, deltaE, hexToLab } from './color/oklab';

export interface ColorOption {
  hex: string;
  /** Where it came from, for the accessibility label. */
  source: 'photo' | 'nearest';
}

export interface FontOption {
  /** Built-in pack whose pairing this is (a stable key). */
  fromPack: string;
  label: string;
  fonts: StylePack['fonts'];
}

export interface ChipOptions {
  paperTypes: readonly StylePack['paper']['type'][];
  paperColors: ColorOption[];
  inkColors: ColorOption[];
  accentColors: ColorOption[];
  fonts: FontOption[];
  headerStyles: { value: StylePack['header']['style']; label: string }[];
}

/** "small-caps-rule" -> "Small caps rule". */
export const enumLabel = (v: string): string => {
  const s = v.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Distinct colours (ΔE >= 0.03 apart), first wins, at most `max`. */
function distinct(options: ColorOption[], max: number): ColorOption[] {
  const out: ColorOption[] = [];
  for (const o of options) {
    if (out.length >= max) break;
    if (!out.some((x) => deltaE(hexToLab(x.hex), hexToLab(o.hex)) < 0.03)) out.push(o);
  }
  return out;
}

export function chipOptions(a: LookAnalysis, base: StylePack, builtIns: readonly StylePack[]): ChipOptions {
  const sw = a.swatches.map((s) => ({ ...s, lab: hexToLab(s.hex) }));
  const paperL = hexToLab(a.paper.color).L;
  const photo = (hex: string): ColorOption => ({ hex, source: 'photo' });
  const nearest = (hex: string): ColorOption => ({ hex, source: 'nearest' });

  // Paper: the matched paper, other large swatches with similar lightness (the same light/dark
  // family), then the nearest pack's paper.
  const paperColors = distinct(
    [photo(a.paper.color), ...sw.filter((s) => s.weight >= 0.02 && Math.abs(s.lab.L - paperL) < 0.25).map((s) => photo(s.hex)), nearest(base.paper.color)],
    5,
  );
  // Ink: strong contrast with the paper.
  const inkColors = distinct(
    [photo(a.ink), ...sw.filter((s) => Math.abs(s.lab.L - paperL) > 0.4).map((s) => photo(s.hex)), nearest(base.palette.ink)],
    5,
  );
  // Header colour: coloured swatches, the matched accent first.
  const accentColors = distinct(
    [
      ...(a.accent ? [photo(a.accent)] : []),
      ...(a.accent2 ? [photo(a.accent2)] : []),
      ...sw.filter((s) => chroma(s.lab) >= 0.05 && Math.abs(s.lab.L - paperL) > 0.13).map((s) => photo(s.hex)),
      nearest(base.palette.accent),
      nearest(base.palette.accent2),
    ],
    6,
  );
  // Fonts: every distinct pairing a built-in pack uses, the nearest pack's first.
  const fonts: FontOption[] = [];
  for (const p of [base, ...builtIns]) {
    const key = `${p.fonts.header}|${p.fonts.body}`;
    if (fonts.some((f) => `${f.fonts.header}|${f.fonts.body}` === key)) continue;
    fonts.push({ fromPack: p.id, label: p.fonts.header === p.fonts.body ? p.fonts.header : `${p.fonts.header} + ${p.fonts.body}`, fonts: { ...p.fonts } });
  }
  return {
    paperTypes: ENUMS.paperType,
    paperColors,
    inkColors,
    accentColors,
    fonts,
    headerStyles: ENUMS.headerStyle.map((value) => ({ value, label: enumLabel(value) })),
  };
}
