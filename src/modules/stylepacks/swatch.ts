/**
 * Native "swatch" model of a pack for the PackPicker (P5, decision Q9 = A).
 *
 * P1 showed each look as its own WebView page preview. With 13 built-in
 * packs plus custom ones that is 13+ WebViews on one screen, too slow on
 * low-end Android phones. The picker instead draws a small native card per
 * pack from this model (paper, paper pattern, ink, header colour,
 * highlighters as they look ON the paper) and shows ONE live WebView
 * preview of the selected pack above the grid.
 *
 * Pure data: no React here, so it is unit-tested.
 */
import { composite } from './color';
import type { StylePack } from './schema';

export interface SwatchModel {
  id: string;
  name: string;
  /** "Best for" line, also used in the accessibility label. */
  caption: string;
  dark: boolean;
  paper: string;
  pattern: StylePack['paper']['type'];
  line: string;
  ink: string;
  accent: string;
  /** Highlighter colours already composited over the paper (what the eye sees), max 4. */
  highlights: string[];
  /** Number of pattern lines to draw in a card ~120 px tall (lineGap scaled down 4x). */
  rows: number;
  custom: boolean;
}

/** Card height the swatch is drawn for; rows follow the pack's lineGap. */
export const SWATCH_HEIGHT = 112;

export function swatchModel(p: StylePack, custom = false): SwatchModel {
  const gap = Math.max(6, Math.round(p.paper.lineGap / 3));
  return {
    id: p.id,
    name: p.name,
    caption: p.meta.bestFor,
    dark: p.meta.appearance === 'dark',
    paper: p.paper.color,
    pattern: p.paper.type,
    line: p.paper.line,
    ink: p.palette.ink,
    accent: p.palette.accent,
    highlights: p.highlighters.slice(0, 4).map((h) => composite(h.color, p.paper.color, h.opacity)),
    rows: Math.floor(SWATCH_HEIGHT / gap),
    custom,
  };
}

/** Screen-reader label: name, light/dark, what it's for. */
export function swatchLabel(m: SwatchModel): string {
  return `${m.name}${m.custom ? ', your look' : ''}. ${m.dark ? 'Dark' : 'Light'} page. Best for ${m.caption}.`;
}
