/**
 * Colour maths (port of StylePacks_v3/contrast.js).
 * contrast(): WCAG 2.x ratio. composite(): highlighter over paper at alpha.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

export function toRgb(hex: string): [number, number, number] {
  if (!HEX.test(hex)) throw new Error('bad_hex');
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function toHex(rgb: readonly number[]): string {
  return (
    '#' +
    rgb
      .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function composite(fg: string, bg: string, alpha: number): string {
  const f = toRgb(fg);
  const b = toRgb(bg);
  return toHex(f.map((v, i) => v * alpha + (b[i] as number) * (1 - alpha)));
}

/** t of b over a */
export const mix = (a: string, b: string, t: number): string => composite(b, a, t);
