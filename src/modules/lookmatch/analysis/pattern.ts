/**
 * Paper pattern detection: lined, grid, dotted or plain; line gap; margin
 * line; texture (MATCH_MATH.md §5).
 *
 * Idea: printed paper lines are thin, regular and run across the WHOLE
 * page, while handwriting and dots cover only part of a row. Per-row and
 * per-column medians and means of the "darkness" separate the two (§5.1),
 * and normalised autocorrelation finds a repeating spacing (§5.2).
 */
import type { LabImage } from './pixels';
import { median } from './pixels';

export type PaperType = 'lined' | 'grid' | 'dotted' | 'plain';
export type PaperMargin = 'none' | 'left' | 'double';
export type Texture = 'none' | 'grain' | 'chalk';

export interface PatternResult {
  type: PaperType;
  /** Spacing of the repeat in analysis pixels, or null for plain paper. */
  periodPx: number | null;
  /** Spacing as a fraction of the image width (§5.4), or null. */
  periodRatio: number | null;
  margin: PaperMargin;
  texture: Texture;
  /** 0..1, how sure we are about `type` (shown as a weak or strong chip). */
  confidence: number;
}

/** A pixel counts as "marked" (ink or line) when its L differs from the paper by more than this (§5.6). */
const MARK_DL = 0.035;
/** Autocorrelation needed to call a profile periodic (§5.2). */
const PERIODIC_MIN = 0.3;
/** Profiles flatter than this (std of L) carry no pattern, only JPEG noise (§5.2). */
const MIN_PROFILE_STD = 0.002;

export interface Profiles {
  /** Row/column MEDIAN darkness: high only where a line crosses the whole page (§5.1). */
  rowMedian: Float64Array;
  colMedian: Float64Array;
  /** Row/column MEAN darkness: also picks up dots and text (§5.1). */
  rowMean: Float64Array;
  colMean: Float64Array;
  /** Pixels clearly off-paper (MARK_DL), for the texture pass. */
  marked: Uint8Array;
}

/**
 * §5.1. Darkness D(x, y) = s * (paperL - L(x, y)), with s = +1 on light
 * paper (lines are darker) and -1 on dark paper (lines are lighter).
 * - The MEDIAN of D along a row is clearly above 0 only if more than half
 *   the row is covered, i.e. a printed line runs across it. Handwriting and
 *   dots cover far less than half a row, so they leave the median at 0. This
 *   works even for very faint lines, because autocorrelation (§5.2) does not
 *   care how strong a signal is, only that it repeats.
 * - The MEAN of D along a row also rises for dot rows and text rows.
 */
export function profiles(img: LabImage): Profiles {
  const { width: w, height: h, lab } = img;
  const s = img.paperL >= 0.5 ? 1 : -1;
  const marked = new Uint8Array(w * h);
  const rowMedian = new Float64Array(h);
  const rowMean = new Float64Array(h);
  const colMedian = new Float64Array(w);
  const colMean = new Float64Array(w);
  const cols: number[][] = Array.from({ length: w }, () => []);
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const L = lab[p * 3] as number;
      if (Number.isNaN(L)) continue;
      const d = s * (img.paperL - L);
      if (Math.abs(d) > MARK_DL) marked[p] = 1;
      row.push(d);
      (cols[x] as number[]).push(d);
    }
    rowMedian[y] = median(row);
    rowMean[y] = row.length ? row.reduce((a, b) => a + b, 0) / row.length : 0;
  }
  for (let x = 0; x < w; x++) {
    const col = cols[x] as number[];
    colMedian[x] = median(col);
    colMean[x] = col.length ? col.reduce((a, b) => a + b, 0) / col.length : 0;
  }
  return { rowMedian, colMedian, rowMean, colMean, marked };
}

function std(a: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m += a[i] as number;
  m /= a.length || 1;
  let v = 0;
  for (let i = 0; i < a.length; i++) v += ((a[i] as number) - m) ** 2;
  return Math.sqrt(v / (a.length || 1));
}

/**
 * §5.2: normalised autocorrelation r(k) = sum (f_i - mean)(f_{i+k} - mean)
 * / sum (f_i - mean)^2 for lags k in [minLag, maxLag]. Returns the lag of
 * the FIRST local maximum whose r reaches PERIODIC_MIN (the fundamental
 * spacing, not a multiple of it), with its r, or null when none does.
 */
export function findPeriod(profile: Float64Array, minLag = 4, maxLagFrac = 1 / 3): { lag: number; r: number } | null {
  const n = profile.length;
  const maxLag = Math.floor(n * maxLagFrac);
  if (maxLag <= minLag || std(profile) < MIN_PROFILE_STD) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += profile[i] as number;
  mean /= n;
  let denom = 0;
  for (let i = 0; i < n; i++) denom += ((profile[i] as number) - mean) ** 2;
  const r = new Float64Array(maxLag + 2);
  for (let k = minLag - 1; k <= maxLag + 1; k++) {
    let sum = 0;
    for (let i = 0; i + k < n; i++) sum += ((profile[i] as number) - mean) * ((profile[i + k] as number) - mean);
    r[k] = sum / denom;
  }
  for (let k = minLag; k <= maxLag; k++) {
    const v = r[k] as number;
    if (v >= PERIODIC_MIN && v >= (r[k - 1] as number) && v >= (r[k + 1] as number)) return { lag: k, r: v };
  }
  return null;
}

/** Two lags describe the same spacing when they differ by at most 20% (§5.3). */
const sameLag = (a: number, b: number) => Math.abs(a - b) <= 0.2 * Math.max(a, b);

/**
 * §5.3 decision table:
 *   row MEDIANS periodic and column MEDIANS periodic        -> grid
 *   row MEDIANS periodic only                               -> lined
 *   row MEANS and column MEANS periodic with the same lag   -> dotted
 *   anything else (including evenly spaced text lines)      -> plain
 * Text on plain paper can make row MEANS periodic, but its column means
 * are irregular (letters don't line up), so it does not count as dotted.
 */
export function classifyPaper(img: LabImage, pf: Profiles = profiles(img)): Pick<PatternResult, 'type' | 'periodPx' | 'periodRatio' | 'confidence'> {
  const rMed = findPeriod(pf.rowMedian);
  const cMed = findPeriod(pf.colMedian);
  if (rMed && cMed) {
    const lag = (rMed.lag + cMed.lag) / 2;
    return { type: 'grid', periodPx: Math.round(lag), periodRatio: lag / img.width, confidence: Math.min(1, (rMed.r + cMed.r) / 2) };
  }
  if (rMed) return { type: 'lined', periodPx: rMed.lag, periodRatio: rMed.lag / img.width, confidence: Math.min(1, rMed.r) };
  const rMean = findPeriod(pf.rowMean);
  const cMean = findPeriod(pf.colMean);
  if (rMean && cMean && sameLag(rMean.lag, cMean.lag)) {
    const lag = (rMean.lag + cMean.lag) / 2;
    return { type: 'dotted', periodPx: Math.round(lag), periodRatio: lag / img.width, confidence: Math.min(1, (rMean.r + cMean.r) / 2) };
  }
  return { type: 'plain', periodPx: null, periodRatio: null, confidence: 0.6 };
}

/** Schema v3 lineGap range (stylepacks schema: int 22..34). */
export const LINE_GAP_MIN = 22;
export const LINE_GAP_MAX = 34;
/** Spacing ratios mapped onto that range (§5.4): narrow ruled about 2.5%, wide about 6% of the width. */
const RATIO_MIN = 0.025;
const RATIO_MAX = 0.06;

/**
 * §5.4: the photo's scale is unknown (a close-up or the whole page), so the
 * absolute spacing can't be copied. We map the spacing RELATIVE to the
 * image width linearly onto the schema range and clamp it. Denser lines in
 * the photo give a smaller gap in the pack; that keeps the "feel".
 */
export function lineGapFromRatio(ratio: number | null, fallback: number): number {
  if (ratio === null || !Number.isFinite(ratio)) return fallback;
  const t = (ratio - RATIO_MIN) / (RATIO_MAX - RATIO_MIN);
  const v = LINE_GAP_MIN + Math.min(1, Math.max(0, t)) * (LINE_GAP_MAX - LINE_GAP_MIN);
  return Math.round(v);
}

/** Minimum chroma for a margin line (red or pink rules are clearly coloured, §5.5). */
const MARGIN_CHROMA = 0.06;
/** Fraction of a column's pixels that must be on the line. */
const MARGIN_FILL = 0.55;

/**
 * §5.5: look at the left 25% of the image for columns where most pixels are
 * coloured (chroma >= MARGIN_CHROMA). Neighbouring hits are one line (a line
 * can be 2-3 px wide after resizing). One line -> 'left', two lines closer
 * than 4% of the width -> 'double'.
 */
export function detectMargin(img: LabImage): PaperMargin {
  const { width: w, height: h, lab } = img;
  const limit = Math.floor(w * 0.25);
  const hits: number[] = [];
  for (let x = 0; x < limit; x++) {
    let n = 0;
    let colored = 0;
    for (let y = 0; y < h; y++) {
      const p = y * w + x;
      if (Number.isNaN(lab[p * 3] as number)) continue;
      n++;
      const a = lab[p * 3 + 1] as number;
      const b = lab[p * 3 + 2] as number;
      if (Math.sqrt(a * a + b * b) >= MARGIN_CHROMA) colored++;
    }
    if (n && colored / n >= MARGIN_FILL) hits.push(x);
  }
  // Group consecutive columns into lines.
  const lines: number[] = [];
  for (const x of hits) {
    const last = lines[lines.length - 1];
    if (last === undefined || x - last > 2) lines.push(x);
    else lines[lines.length - 1] = x;
  }
  if (lines.length === 0) return 'none';
  if (lines.length >= 2 && (lines[1] as number) - (lines[0] as number) <= Math.max(3, w * 0.04)) return 'double';
  return 'left';
}

/**
 * §5.6: texture = leftover pixel-to-pixel noise on UNMARKED paper pixels,
 * measured as the median absolute difference between horizontal
 * neighbours (robust to the odd stray mark). Smooth digital paper is about
 * 0.002; a photographed grainy or chalky page is above GRAIN_NOISE.
 * Dark paper with noise reads as chalk, light paper as grain.
 */
const GRAIN_NOISE = 0.012;

export function detectTexture(img: LabImage, marked: Uint8Array): { texture: Texture; noise: number } {
  const { width: w, height: h, lab } = img;
  const diffs: number[] = [];
  // Every 2nd row and column keeps this cheap; that is plenty of pairs.
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x + 1 < w; x += 2) {
      const p = y * w + x;
      if (marked[p] || marked[p + 1]) continue;
      const a = lab[p * 3] as number;
      const b = lab[(p + 1) * 3] as number;
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      diffs.push(Math.abs(a - b));
    }
  }
  const noise = median(diffs);
  if (noise < GRAIN_NOISE) return { texture: 'none', noise };
  return { texture: img.paperL < 0.5 ? 'chalk' : 'grain', noise };
}

/** The whole §5 pass for one image. */
export function analyzePattern(img: LabImage): PatternResult {
  const pf = profiles(img);
  return {
    ...classifyPaper(img, pf),
    margin: detectMargin(img),
    texture: detectTexture(img, pf.marked).texture,
  };
}
