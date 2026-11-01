/**
 * SYNTHETIC test pages (not real photos). Draws a note page in a given look:
 * paper colour, ruled/grid/dotted pattern, margin line, a header in the
 * accent colour, stroke "handwriting" in the ink colour, highlighter
 * swipes, plus optional uneven lighting and sensor noise. Used to check the
 * on-device pass (MATCH_MATH.md §2-§6) recovers what was drawn. Real
 * photos are checked only in Rey's device test (UNVERIFIED until then).
 *
 * Handwriting is drawn as thin strokes, so a row through the letters is
 * covered well under half (like real writing), which is what the row-median
 * line detector relies on (§5.1).
 */
import { mulberry32 } from '../../analysis/kmeans';
import type { RgbaImage } from '../../analysis/pixels';
import { hexToRgb } from '../../color/oklab';

export interface SynthSpec {
  width?: number;
  height?: number;
  paper: string;
  line: string;
  type: 'lined' | 'grid' | 'dotted' | 'plain';
  /** Pattern spacing in pixels. */
  period: number;
  margin?: 'none' | 'left' | 'double';
  marginColor?: string;
  ink: string;
  accent: string;
  /** Highlighter pens and opacities (drawn composited over the paper). */
  highlighters?: { color: string; opacity: number }[];
  /** 0 = flat; 0.15 = the far corner is 15% darker (a phone's shadow). */
  shadow?: number;
  /** Per-channel noise amplitude, 0-255. */
  noise?: number;
  /** Text lines to write (default: most of the page). */
  textLines?: number;
  seed?: number;
}

export function synthPage(s: SynthSpec): RgbaImage {
  const w = s.width ?? 288;
  const h = s.height ?? 384;
  const rand = mulberry32(s.seed ?? 7);
  const px = new Float64Array(w * h * 3);
  const set = (x: number, y: number, rgb: readonly number[], alpha = 1) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = (y * w + x) * 3;
    for (let c = 0; c < 3; c++) px[p + c] = (rgb[c] as number) * alpha + (px[p + c] as number) * (1 - alpha);
  };
  const paper = hexToRgb(s.paper);
  for (let p = 0; p < w * h; p++) px.set(paper, p * 3);

  // Pattern.
  const line = hexToRgb(s.line);
  const P = s.period;
  if (s.type === 'lined' || s.type === 'grid') {
    for (let y = P; y < h; y += P) for (let x = 0; x < w; x++) set(x, Math.round(y), line);
  }
  if (s.type === 'grid') {
    for (let x = P; x < w; x += P) for (let y = 0; y < h; y++) set(Math.round(x), y, line);
  }
  if (s.type === 'dotted') {
    for (let y = P; y < h; y += P) for (let x = P; x < w; x += P) {
      set(Math.round(x), Math.round(y), line);
      set(Math.round(x) + 1, Math.round(y), line);
      set(Math.round(x), Math.round(y) + 1, line);
      set(Math.round(x) + 1, Math.round(y) + 1, line);
    }
  }
  // Margin.
  const mc = hexToRgb(s.marginColor ?? '#E0607A');
  const mx = Math.round(w * 0.12);
  if (s.margin === 'left' || s.margin === 'double') for (let y = 0; y < h; y++) {
    set(mx, y, mc);
    set(mx + 1, y, mc);
    if (s.margin === 'double') {
      set(mx + 5, y, mc);
      set(mx + 6, y, mc);
    }
  }

  const left = s.margin && s.margin !== 'none' ? mx + 10 : 14;
  // A "word" of stroke letters at (x, base), letters 5 px wide, `tall` px high.
  const word = (x0: number, base: number, letters: number, tall: number, rgb: readonly number[], thick = 1) => {
    let x = x0;
    for (let l = 0; l < letters; l++) {
      for (let y = base - tall; y < base; y++) {
        for (let t = 0; t < thick; t++) {
          set(x + t, y, rgb);
          set(x + 3 + t, y, rgb);
        }
      }
      for (let xx = x; xx <= x + 3; xx++) if (rand() < 0.25) set(xx, base - tall, rgb);
      x += 5 + thick + Math.floor(rand() * 4); // irregular letter spacing, like handwriting
    }
    return x;
  };

  // Header in the accent colour, with the first highlighter behind it.
  const accent = hexToRgb(s.accent);
  const hl = s.highlighters ?? [];
  // Headers are big and bold in real notes: 2 lines of 18 px, 2 px strokes (about 1.5% of the page).
  const headBase = Math.max(30, Math.round(P * 3));
  if (hl[0]) {
    const c = hexToRgb(hl[0].color);
    for (let y = headBase - 20; y < headBase + 3; y++) for (let x = left - 3; x < left + 130; x++) set(x, y, c, hl[0].opacity);
  }
  for (const hb of [headBase, headBase + Math.max(24, Math.round(P * 2))]) {
    let hx = left;
    for (let wd = 0; wd < 3; wd++) hx = word(hx, hb, 3 + Math.floor(rand() * 3), 18, accent, 2) + 9;
  }

  // Body text on every pattern line (or every 12 px on plain paper).
  const ink = hexToRgb(s.ink);
  const step = s.type === 'plain' ? 12 : Math.max(8, P);
  const lines = s.textLines ?? Math.floor((h - headBase - 30) / step);
  for (let i = 0; i < lines; i++) {
    const base = Math.round(headBase + Math.max(24, P * 2) + step * (i + 2)) - 1;
    if (base >= h - 6) break;
    let x = left + Math.floor(rand() * 8); // people don't start every line in the same pixel column
    const end = w - 14 - Math.floor(rand() * 60);
    let wordNo = 0;
    while (x < end - 30) {
      const letters = 2 + Math.floor(rand() * 5);
      // Highlighters 2..n: swipe behind some words (a few % of the page each).
      const pick = hl.length > 1 && rand() < 0.16 ? (1 + (wordNo % (hl.length - 1))) : -1;
      if (pick > 0) {
        const c = hexToRgb((hl[pick] as { color: string }).color);
        for (let y = base - 9; y < base + 2; y++) for (let xx = x - 2; xx < x + letters * 6.5 + 2; xx++) set(xx, y, c, (hl[pick] as { opacity: number }).opacity);
      }
      x = word(x, base, letters, 6, ink) + 6;
      wordNo++;
    }
  }

  // Lighting and noise, then 8-bit RGBA.
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    const shade = 1 - (s.shadow ?? 0) * ((x / w + y / h) / 2);
    for (let c = 0; c < 3; c++) {
      const n = s.noise ? (rand() - 0.5) * 2 * s.noise : 0;
      data[p * 4 + c] = Math.max(0, Math.min(255, Math.round((px[p * 3 + c] as number) * shade + n)));
    }
    data[p * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}
