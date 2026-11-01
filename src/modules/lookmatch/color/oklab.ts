/**
 * OKLab colour maths for reference matching (MATCH_MATH.md §1).
 *
 * Why OKLab: k-means, "nearest pack" and the blend slider all need a space
 * where straight-line distance matches how different two colours LOOK.
 * sRGB is not like that (equal steps in blue look smaller than in green);
 * OKLab (Björn Ottosson, 2020) is close to perceptually uniform and is
 * cheap: two 3x3 matrices and a cube root (§1.2).
 *
 * Every function here is pure and works on plain numbers, so it runs the
 * same in Hermes, Node (tests) and the build scripts.
 */

/** A colour in OKLab: L lightness 0..1, a green-red, b blue-yellow (about -0.4..0.4). */
export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** An sRGB colour with 0..255 channels (not rounded while we compute). */
export type Rgb = readonly [number, number, number];

const HEX6 = /^#([0-9a-fA-F]{6})$/;

/** "#RRGGBB" -> [r, g, b] (0..255). Throws on anything else: callers pass validated hex. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = HEX6.exec(hex);
  if (!m) throw new Error('bad_hex');
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r, g, b] -> "#RRGGBB" (upper case, like the bundled packs). Clamps and rounds each channel. */
export function rgbToHex(c: Rgb): string {
  return `#${c
    .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

// --- §1.1 sRGB transfer function -------------------------------------------

/** sRGB channel 0..255 -> linear light 0..1 (§1.1, IEC 61966-2-1 piecewise curve). */
export function srgbToLinear(c255: number): number {
  const c = c255 / 255;
  // Below the knee the curve is a straight line; above it, a 2.4 power curve.
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light 0..1 -> sRGB channel 0..255 (§1.1, inverse curve). Not clamped. */
export function linearToSrgb(l: number): number {
  // Out-of-gamut results can be negative; keep the sign so clamping happens once, at the end.
  const s = l < 0 ? -1 : 1;
  const x = Math.abs(l);
  const c = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return s * c * 255;
}

/**
 * Precomputed sRGB -> linear table for 0..255. Image analysis converts about
 * 65k pixels per photo, and Math.pow per channel is the hot spot (§2.1).
 */
const LINEAR_TABLE: Float64Array = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i);
  return t;
})();

// --- §1.2 linear sRGB <-> OKLab ----------------------------------------------

/** sRGB 0..255 -> OKLab (§1.2: M1, cube root, M2). Integer inputs use the lookup table. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = Number.isInteger(r) && r >= 0 && r <= 255 ? (LINEAR_TABLE[r] as number) : srgbToLinear(r);
  const lg = Number.isInteger(g) && g >= 0 && g <= 255 ? (LINEAR_TABLE[g] as number) : srgbToLinear(g);
  const lb = Number.isInteger(b) && b >= 0 && b <= 255 ? (LINEAR_TABLE[b] as number) : srgbToLinear(b);
  // M1: linear sRGB -> approximate cone responses (LMS).
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  // Non-linearity: cube root (Math.cbrt keeps the sign, so tiny negatives are safe).
  const l3 = Math.cbrt(l);
  const m3 = Math.cbrt(m);
  const s3 = Math.cbrt(s);
  // M2: compressed LMS -> L, a, b.
  return {
    L: 0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3,
    a: 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3,
    b: 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3,
  };
}

/** OKLab -> sRGB 0..255, NOT clamped (§1.2 inverse: M2^-1, cube, M1^-1). */
export function labToRgbUnclamped(c: Lab): [number, number, number] {
  const l3 = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b;
  const m3 = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b;
  const s3 = c.L - 0.0894841775 * c.a - 1.291485548 * c.b;
  const l = l3 * l3 * l3;
  const m = m3 * m3 * m3;
  const s = s3 * s3 * s3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export const hexToLab = (hex: string): Lab => {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
};

/**
 * OKLab -> "#RRGGBB". Out-of-gamut colours are brought into gamut by
 * reducing chroma at constant L and hue (§1.5), not by clipping channels,
 * which would shift the hue (a vivid pink would turn orange).
 */
export function labToHex(c: Lab): string {
  return rgbToHex(gamutMap(c));
}

/** §1.5 chroma reduction by bisection until every channel is in 0..255. */
export function gamutMap(c: Lab): [number, number, number] {
  const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.5 && v <= 255.5);
  const direct = labToRgbUnclamped(c);
  if (inGamut(direct)) return direct;
  // L outside 0..1 cannot be fixed by chroma; clamp L first.
  const L = Math.min(1, Math.max(0, c.L));
  let lo = 0; // scale known to be in gamut (a grey)
  let hi = 1; // scale known to be out of gamut
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(labToRgbUnclamped({ L, a: c.a * mid, b: c.b * mid }))) lo = mid;
    else hi = mid;
  }
  return labToRgbUnclamped({ L, a: c.a * lo, b: c.b * lo });
}

// --- §1.3 distance, §1.4 chroma and hue --------------------------------------

/** Euclidean distance in OKLab (§1.3). About 0.02 is "just noticeable"; 0.1 is clearly different. */
export function deltaE(x: Lab, y: Lab): number {
  const dL = x.L - y.L;
  const da = x.a - y.a;
  const db = x.b - y.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/** Chroma C = sqrt(a^2 + b^2) (§1.4): 0 for greys, about 0.1+ for clearly coloured inks. */
export function chroma(c: Lab): number {
  return Math.sqrt(c.a * c.a + c.b * c.b);
}

/** Hue angle h = atan2(b, a) in degrees 0..360 (§1.4). Meaningless when chroma is near 0. */
export function hue(c: Lab): number {
  const h = (Math.atan2(c.b, c.a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/** Linear interpolation in OKLab (§9.1): t = 0 gives x, t = 1 gives y. */
export function mixLab(x: Lab, y: Lab, t: number): Lab {
  return { L: x.L + (y.L - x.L) * t, a: x.a + (y.a - x.a) * t, b: x.b + (y.b - x.b) * t };
}

/** Hex-to-hex blend through OKLab (§9.1). */
export function mixHexOklab(x: string, y: string, t: number): string {
  return labToHex(mixLab(hexToLab(x), hexToLab(y), t));
}
