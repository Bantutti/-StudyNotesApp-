/**
 * From decoded pixels to OKLab samples (MATCH_MATH.md §2).
 *
 * The image arrives already shrunk (long side <= ANALYSIS_LONG_SIDE, see
 * image/limits.ts) and sanitized. Here we:
 *   1. convert every pixel to OKLab (§2.1),
 *   2. estimate the lighting across the page and flatten it (§2.2), so a
 *      photo with a shadow in one corner still gives one paper colour,
 *   3. pick an evenly spaced subset of pixels for k-means (§2.3).
 */
import { rgbaToLabInto } from '../color/oklab';

/** Decoded, non-premultiplied RGBA pixels, row by row (4 bytes per pixel). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** The same image in OKLab, plus the lighting map used to flatten it. */
export interface LabImage {
  width: number;
  height: number;
  /** Flattened OKLab, 3 numbers per pixel (L, a, b). */
  lab: Float64Array;
  /** Local paper lightness per pixel before flattening (§2.2), for the pattern pass. */
  localPaperL: Float64Array;
  /** Global paper lightness every pixel was shifted toward (§2.2). */
  paperL: number;
}

/** Pixels whose alpha is below this are ignored (transparent screenshot borders). */
const MIN_ALPHA = 128;
/** Block size for the lighting estimate (§2.2), in analysis pixels. */
const BLOCK = 16;

/** Throws when the buffer does not match width x height x 4 (a decoder bug or hostile input). */
export function assertRgba(img: RgbaImage): void {
  if (!Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width < 8 || img.height < 8) {
    throw new Error('image_too_small');
  }
  if (img.data.length !== img.width * img.height * 4) throw new Error('rgba_size_mismatch');
}

/** Median of a typed array, sorted IN PLACE (numeric sort, no comparator call per element). */
export function medianTyped(a: Float64Array): number {
  if (a.length === 0) return 0;
  a.sort();
  const mid = a.length >> 1;
  return a.length % 2 ? (a[mid] as number) : ((a[mid - 1] as number) + (a[mid] as number)) / 2;
}

/** Median of a small numeric array (copies, does not reorder the input). */
export function median(values: ArrayLike<number>): number {
  const a = Array.from(values).sort((x, y) => x - y);
  if (a.length === 0) return 0;
  const mid = a.length >> 1;
  return a.length % 2 ? (a[mid] as number) : ((a[mid - 1] as number) + (a[mid] as number)) / 2;
}

/** q-quantile (0..1) of a numeric array, nearest-rank. */
export function percentile(values: readonly number[], q: number): number {
  const a = [...values].sort((x, y) => x - y);
  return (a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))] as number) ?? 0;
}

/**
 * §2.1 + §2.2. Lighting estimate: split the image into BLOCK x BLOCK tiles
 * and take the MEDIAN lightness of each tile. On a note page most pixels in
 * any tile are paper (text covers well under half), so the median is the
 * local paper lightness, and it ignores the ink. Tiles are blended with
 * bilinear interpolation between tile centres, so there are no seams.
 * Each pixel's L is then shifted by (global paper L - local paper L).
 * The shift is additive in L because OKLab L is already close to perceived
 * lightness; a and b (the colour) are left alone.
 */
export function toLabImage(img: RgbaImage): LabImage {
  assertRgba(img);
  const { width: w, height: h, data } = img;
  const lab = new Float64Array(w * h * 3);
  rgbaToLabInto(data, w * h, lab);
  const opaque = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) opaque[i] = (data[i * 4 + 3] as number) >= MIN_ALPHA ? 1 : 0;

  // Tile medians.
  const tx = Math.max(1, Math.ceil(w / BLOCK));
  const ty = Math.max(1, Math.ceil(h / BLOCK));
  const tile = new Float64Array(tx * ty);
  const all: number[] = [];
  const scratch = new Float64Array(BLOCK * BLOCK);
  for (let j = 0; j < ty; j++) {
    for (let i = 0; i < tx; i++) {
      let n = 0;
      for (let y = j * BLOCK; y < Math.min(h, (j + 1) * BLOCK); y++) {
        for (let x = i * BLOCK; x < Math.min(w, (i + 1) * BLOCK); x++) {
          const p = y * w + x;
          if (opaque[p]) scratch[n++] = lab[p * 3] as number;
        }
      }
      const m = n ? medianTyped(scratch.subarray(0, n)) : NaN;
      tile[j * tx + i] = m;
      if (!Number.isNaN(m)) all.push(m);
    }
  }
  // Global paper lightness: the 90th percentile of tile medians, i.e. the best-lit part of the page.
  // A shadow only ever darkens, so the lit tiles show the paper's real colour (§2.2).
  const paperL = all.length ? percentile(all, 0.9) : 0.5;
  // Fully transparent tiles take the global value.
  for (let t = 0; t < tile.length; t++) if (Number.isNaN(tile[t])) tile[t] = paperL;

  // Bilinear interpolation between tile centres, then the additive shift.
  const localPaperL = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(ty - 1, Math.max(0, (y + 0.5) / BLOCK - 0.5));
    const j0 = Math.floor(fy);
    const j1 = Math.min(ty - 1, j0 + 1);
    const vy = fy - j0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(tx - 1, Math.max(0, (x + 0.5) / BLOCK - 0.5));
      const i0 = Math.floor(fx);
      const i1 = Math.min(tx - 1, i0 + 1);
      const vx = fx - i0;
      const top = (tile[j0 * tx + i0] as number) * (1 - vx) + (tile[j0 * tx + i1] as number) * vx;
      const bot = (tile[j1 * tx + i0] as number) * (1 - vx) + (tile[j1 * tx + i1] as number) * vx;
      const local = top * (1 - vy) + bot * vy;
      const p = y * w + x;
      localPaperL[p] = local;
      lab[p * 3] = (lab[p * 3] as number) + (paperL - local);
    }
  }
  // Transparent pixels are marked with NaN so later passes skip them.
  for (let p = 0; p < w * h; p++) if (!opaque[p]) lab[p * 3] = NaN;
  return { width: w, height: h, lab, localPaperL, paperL };
}

/**
 * §2.3: an evenly spaced subset of at most `max` pixels (a fixed stride, so
 * the result is deterministic), skipping transparent ones. Returns the flat
 * [L, a, b, ...] array k-means expects.
 */
export function sampleLab(img: LabImage, max: number): Float64Array {
  const n = img.width * img.height;
  const stride = Math.max(1, Math.ceil(n / max));
  const out: number[] = [];
  for (let p = 0; p < n; p += stride) {
    const L = img.lab[p * 3] as number;
    if (Number.isNaN(L)) continue;
    out.push(L, img.lab[p * 3 + 1] as number, img.lab[p * 3 + 2] as number);
  }
  return Float64Array.from(out);
}
