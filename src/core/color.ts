/**
 * Colour maths for app chrome (WCAG 2.x relative luminance and contrast).
 * Packs have their own copy in stylepacks; core can't import modules.
 */
const HEX = /^#?([0-9a-fA-F]{6})$/;

function rgb(hex: string): [number, number, number] {
  const m = HEX.exec(hex);
  if (!m) throw new Error('bad_hex');
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: readonly number[]) =>
  `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Mixes a toward b by t (0..1). */
export function mixHex(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  return toHex(ca.map((v, i) => v + ((cb[i] as number) - v) * t));
}

/**
 * Returns `fg`, darkened (on light backgrounds) or lightened (on dark ones)
 * just enough to reach `min` contrast against `bg`. Keeps the hue family,
 * so a subject's colour still reads as that colour.
 */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrastRatio(fg, bg) >= min) return toHex(rgb(fg));
  const toward = luminance(bg) > 0.18 ? '#000000' : '#FFFFFF';
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mixHex(fg, toward, mid), bg) >= min) hi = mid;
    else lo = mid;
  }
  return mixHex(fg, toward, hi);
}

/**
 * A filled control (button, chip) in `color` with readable text on it.
 * Preference: white text on the colour as is; else white text on the colour
 * darkened by at most 25% (keeps it recognisably the subject colour, e.g.
 * the plan's #4F7CF7 needs a small darkening); else near-black text.
 */
export function solidColors(color: string, min = 4.5): { fill: string; text: string } {
  const white = '#FFFFFF';
  const ink = '#111318';
  const raw = toHex(rgb(color));
  if (contrastRatio(white, raw) >= min) return { fill: raw, text: white };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(white, mixHex(raw, '#000000', mid)) >= min) hi = mid;
    else lo = mid;
  }
  if (hi <= 0.25) return { fill: mixHex(raw, '#000000', hi), text: white };
  return { fill: raw, text: ink };
}
