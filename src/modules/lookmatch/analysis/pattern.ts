/**
 * Paper pattern detection: lined, grid, dotted or plain; line gap; margin
 * line; texture (MATCH_MATH.md §5).
 *
 * Idea: printed paper lines are thin, regular and run across the WHOLE
 * page, while handwriting and dots cover only part of a row. Per-row and
 * per-column medians and means of the "darkness" separate the two (§5.1),
 * and normalised autocorrelation finds a repeating spacing (§5.2).
 */
import { labToHex } from '../color/oklab';

import type { LabImage } from './pixels';
import { median, medianTyped } from './pixels';

export type PaperType = 'lined' | 'grid' | 'dotted' | 'plain';
export type PaperMargin = 'none' | 'left' | 'double';
export type Texture = 'none' | 'grain' | 'chalk';

export interface PatternResult {
  type: PaperType;
  /** Median colour of the pattern's pixels (§5.7), or null for plain paper. */
  lineColor: string | null;
  /** Median colour of the margin rule (§5.5), or null. */
  marginColor: string | null;
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
  // Darkness per pixel, stored column-major too so column medians need no gather.
  const dRow = new Float64Array(w);
  const dCols = new Float64Array(w * h);
  const colN = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    let n = 0;
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const L = lab[p * 3] as number;
      if (Number.isNaN(L)) continue;
      const d = s * (img.paperL - L);
      if (Math.abs(d) > MARK_DL) marked[p] = 1;
      dRow[n++] = d;
      sum += d;
      const c = colN[x] as number;
      dCols[x * h + c] = d;
      colN[x] = c + 1;
      colMean[x] = (colMean[x] as number) + d;
    }
    rowMedian[y] = medianTyped(dRow.subarray(0, n));
    rowMean[y] = n ? sum / n : 0;
  }
  for (let x = 0; x < w; x++) {
    const n = colN[x] as number;
    colMedian[x] = medianTyped(dCols.subarray(x * h, x * h + n));
    colMean[x] = n ? (colMean[x] as number) / n : 0;
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

/** §5.2 a profile capped at its 97th percentile: a few spike rows/columns (aligned text starts, a margin rule) can't drown a faint repeating pattern. */
export function clipProfile(profile: Float64Array, q = 0.97): Float64Array {
  const sorted = Array.from(profile).sort((a, b) => a - b);
  const cap = sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
  return profile.map((v) => Math.min(v, cap));
}

/** §5.2 normalised autocorrelation r(k) of a (clipped) profile for k = 0..maxLag+1; null when the profile is flat. */
/**
 * §5.2 detrend: subtract a centred moving average (DETREND_WINDOW px). Slow
 * changes across the page (text only on the left half, a darker lower
 * half) would otherwise make r(k) high at EVERY lag; the repeating pattern
 * (spacing at most ~0.06 of the width, so < 24 px here) survives.
 */
export const DETREND_WINDOW = 33;
export function detrend(p: Float64Array, win = DETREND_WINDOW): Float64Array {
  const n = p.length;
  const half = Math.floor(win / 2);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = (prefix[i] as number) + (p[i] as number);
  return p.map((v, i) => {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    return v - ((prefix[b] as number) - (prefix[a] as number)) / (b - a);
  });
}

export function autocorr(profileIn: Float64Array, maxLag: number): Float64Array | null {
  const profile = detrend(clipProfile(profileIn));
  const n = profile.length;
  if (std(profile) < MIN_PROFILE_STD) return null; // a flat profile has no pattern, only noise
  let mean = 0;
  for (let i = 0; i < n; i++) mean += profile[i] as number;
  mean /= n;
  let denom = 0;
  for (let i = 0; i < n; i++) denom += ((profile[i] as number) - mean) ** 2;
  const r = new Float64Array(maxLag + 2);
  for (let k = 0; k <= maxLag + 1; k++) {
    let sum = 0;
    for (let i = 0; i + k < n; i++) sum += ((profile[i] as number) - mean) * ((profile[i + k] as number) - mean);
    r[k] = sum / denom;
  }
  return r;
}

/**
 * §5.2: the lag of the FIRST local maximum of r(k) that reaches
 * PERIODIC_MIN (the fundamental spacing, not a multiple of it) AND repeats:
 * r(2k) > 0 as well (§5.2 repeat check: two lone spikes, like a double
 * margin rule, give a high r at their distance but nothing at twice it).
 */
export function findPeriod(profile: Float64Array, minLag = 4, maxLagFrac = 1 / 3): { lag: number; r: number } | null {
  const maxLag = Math.floor(profile.length * maxLagFrac);
  if (maxLag <= minLag) return null;
  const r = autocorr(profile, Math.min(profile.length - 2, maxLag * 2));
  if (!r) return null;
  for (let k = minLag; k <= maxLag; k++) {
    const v = r[k] as number;
    if (v >= PERIODIC_MIN && v >= (r[k - 1] as number) && v >= (r[k + 1] as number) && (r[2 * k] ?? 0) > 0) return { lag: k, r: v };
  }
  return null;
}

/**
 * §5.3 square-lattice test for dots: printed dot grids have the same
 * spacing across and down. Given the row spacing P, look for the column
 * autocorrelation peak within ±15% of P only. Handwriting's letter spacing
 * is irregular and usually much smaller than the dot spacing.
 */
export function latticeMatch(profile: Float64Array, lag: number): { lag: number; r: number } | null {
  const lo = Math.max(2, Math.floor(lag * 0.85));
  const hi = Math.ceil(lag * 1.15);
  const r = autocorr(profile, Math.min(profile.length - 2, hi * 2));
  if (!r) return null;
  let best: { lag: number; r: number } | null = null;
  for (let k = lo; k <= hi; k++) if (!best || (r[k] as number) > best.r) best = { lag: k, r: r[k] as number };
  if (!best || best.r < PERIODIC_MIN || (r[2 * best.lag] ?? 0) <= 0) return null;
  return best;
}

/**
 * §5.3 margin test: printed ruling and dot grids run to the edges of the
 * paper (and of a cropped photo); handwriting stops at the margins and is
 * ragged on the right. So the same row spacing must ALSO show up inside at
 * least one outer strip (left or right) of the page. The strip is at least
 * one spacing wide, so a dot column always falls inside it. Returns the
 * strip's row profile that passed, or null.
 */
export interface StripHit {
  /** Row profile of the strip that showed the pattern. */
  prof: Float64Array;
  /** First column of that strip and its width. */
  from: number;
  width: number;
}

export function rowPatternInStrips(img: LabImage, lag: number): StripHit | null {
  const { width: w, height: h, lab } = img;
  const s = img.paperL >= 0.5 ? 1 : -1;
  const sw = Math.min(Math.floor(w / 4), Math.max(3, Math.ceil(Math.max(0.03 * w, 1.2 * lag))));
  const stripProfile = (from: number) => {
    const prof = new Float64Array(h);
    for (let y = 0; y < h; y++) {
      let sum = 0;
      let n = 0;
      for (let x = from; x < from + sw; x++) {
        const L = lab[(y * w + x) * 3] as number;
        if (Number.isNaN(L)) continue;
        sum += s * (img.paperL - L);
        n++;
      }
      prof[y] = n ? sum / n : 0;
    }
    return prof;
  };
  for (const from of [w - sw, 0]) {
    const prof = stripProfile(from);
    if (latticeMatch(prof, lag)) return { prof, from, width: sw };
  }
  return null;
}

/**
 * §5.3 dot columns: average the darkness down ONLY the dot rows (the rows
 * where the clean strip's profile peaks), so the text between dot rows
 * doesn't dilute the column pattern.
 */
/** Dot rows = local peaks of the strip profile that reach 30% of the typical (90th percentile) peak. */
function dotRows(stripRows: Float64Array): number[] {
  const peaks: number[] = [];
  for (let y = 1; y + 1 < stripRows.length; y++) {
    const v = stripRows[y] as number;
    if (v > 0 && v >= (stripRows[y - 1] as number) && v >= (stripRows[y + 1] as number)) peaks.push(y);
  }
  const vals = peaks.map((y) => stripRows[y] as number).sort((a, b) => a - b);
  const bar = 0.3 * ((vals[Math.floor(0.9 * (vals.length - 1))] as number) ?? 0);
  return peaks.filter((y) => (stripRows[y] as number) >= bar);
}

function dotColumnProfile(img: LabImage, stripRows: Float64Array): Float64Array {
  const { width: w, lab } = img;
  const s = img.paperL >= 0.5 ? 1 : -1;
  // A single stray mark can't raise the bar the way a "half the maximum" rule would.
  const rows = dotRows(stripRows);
  const prof = new Float64Array(w);
  for (const y of rows) for (let x = 0; x < w; x++) prof[x] = (prof[x] as number) + s * (img.paperL - (lab[(y * w + x) * 3] as number));
  return prof.map((v) => v / Math.max(1, rows.length));
}

/** Two lags describe the same spacing when they differ by at most 20% (§5.3). */
const sameLag = (a: number, b: number) => Math.abs(a - b) <= 0.2 * Math.max(a, b);

/**
 * §5.3 decision table:
 *   row MEDIANS periodic and column MEDIANS periodic        -> grid
 *   row MEDIANS periodic only                               -> lined
 *   row MEANS periodic, and the dot rows' columns repeat at  -> dotted
 *   the same spacing (±15%, latticeMatch, dotColumnProfile)
 *   anything else (including evenly spaced text lines)      -> plain
 * and horizontal patterns must pass the margin test (rowPatternInStrips):
 * the same spacing repeats inside an outer strip, where nobody writes.
 * Text on plain paper can make row MEANS periodic, but its column means
 * are irregular (letters don't line up), so it does not count as dotted.
 */
/**
 * §5.3 line strength: the typical darkness of the strongest row (or column)
 * in each period. A printed rule, even a pale blue one shrunk to the 384 px
 * analysis copy, is about 0.02-0.03 darker than the paper in L; faint
 * repeats below MIN_LINE_DL are shading or highlighter edges, not ruling.
 */
export const MIN_LINE_DL = 0.01;
export function lineStrength(profile: Float64Array, lag: number): number {
  const top = topIndices(profile, Math.max(1, Math.floor(profile.length / lag)));
  return median(top.map((i) => profile[i] as number));
}

export function classifyPaper(img: LabImage, pf: Profiles = profiles(img)): Pick<PatternResult, 'type' | 'periodPx' | 'periodRatio' | 'confidence'> {
  let rMed = findPeriod(pf.rowMedian);
  if (rMed && (lineStrength(pf.rowMedian, rMed.lag) < MIN_LINE_DL || !rowPatternInStrips(img, rMed.lag))) rMed = null;
  // Vertical lines: the column MEDIAN alone is enough (text never covers half a column).
  let cMed = findPeriod(pf.colMedian);
  if (cMed && lineStrength(pf.colMedian, cMed.lag) < MIN_LINE_DL) cMed = null;
  if (rMed && cMed) {
    const lag = (rMed.lag + cMed.lag) / 2;
    return { type: 'grid', periodPx: Math.round(lag), periodRatio: lag / img.width, confidence: Math.min(1, (rMed.r + cMed.r) / 2) };
  }
  if (rMed) return { type: 'lined', periodPx: rMed.lag, periodRatio: rMed.lag / img.width, confidence: Math.min(1, rMed.r) };
  const rMean = findPeriod(pf.rowMean);
  const strip = rMean ? rowPatternInStrips(img, rMean.lag) : null;
  const cMean = rMean && strip ? latticeMatch(dotColumnProfile(img, strip.prof), rMean.lag) : null;
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
export function detectMargin(img: LabImage): { margin: PaperMargin; columns: number[] } {
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
  // Group consecutive columns into lines (start column of each group).
  const groups: number[][] = [];
  for (const x of hits) {
    const g = groups[groups.length - 1];
    if (g && x - (g[g.length - 1] as number) <= 2) g.push(x);
    else groups.push([x]);
  }
  if (groups.length === 0) return { margin: 'none', columns: [] };
  const starts = groups.map((g) => g[0] as number);
  const double = groups.length >= 2 && (starts[1] as number) - (starts[0] as number) <= Math.max(3, w * 0.04);
  return { margin: double ? 'double' : 'left', columns: (double ? groups.slice(0, 2) : groups.slice(0, 1)).flat() };
}

/** Median OKLab colour of the given pixels -> hex, or null when there are none (§5.7). */
function medianColor(img: LabImage, pixels: number[]): string | null {
  if (pixels.length === 0) return null;
  const pick = (o: number) => median(pixels.map((p) => img.lab[p * 3 + o] as number));
  return labToHex({ L: pick(0), a: pick(1), b: pick(2) });
}

/** Indices of the `count` largest values of a profile (the pattern's rows or columns). */
function topIndices(profile: Float64Array, count: number): number[] {
  return Array.from(profile, (v, i) => [v, i] as const)
    .sort((x, y) => y[0] - x[0])
    .slice(0, Math.max(1, count))
    .map(([, i]) => i);
}

/**
 * §5.7 pattern colour: take the rows (and columns) where the pattern is
 * strongest, one per period, and the median colour of their pixels that
 * are darker (lighter on dark paper) than the paper by at least half that
 * row's median darkness. Text crossing those rows is a minority, so the
 * median ignores it.
 */
export function patternColor(img: LabImage, pf: Profiles, type: PaperType, lag: number | null): string | null {
  if (type === 'plain' || lag === null) return null;
  const { width: w, height: h, lab } = img;
  const s = img.paperL >= 0.5 ? 1 : -1;
  const dark = (p: number) => s * (img.paperL - (lab[p * 3] as number));
  const px: number[] = [];
  if (type === 'dotted') {
    // Dots: only inside the clean outer strip (no handwriting there), on the dot rows.
    const strip = rowPatternInStrips(img, lag);
    if (!strip) return null;
    for (const y of dotRows(strip.prof)) {
      for (let x = strip.from; x < strip.from + strip.width; x++) if (dark(y * w + x) > MARK_DL / 2) px.push(y * w + x);
    }
    return medianColor(img, px);
  }
  for (const y of topIndices(pf.rowMedian, Math.ceil(h / lag))) {
    const half = (pf.rowMedian[y] as number) / 2;
    for (let x = 0; x < w; x++) if (dark(y * w + x) >= half) px.push(y * w + x);
  }
  return medianColor(img, px);
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
  const cls = classifyPaper(img, pf);
  const m = detectMargin(img);
  const marginPx: number[] = [];
  for (const x of m.columns) for (let y = 0; y < img.height; y++) marginPx.push(y * img.width + x);
  return {
    ...cls,
    lineColor: patternColor(img, pf, cls.type, cls.periodPx),
    margin: m.margin,
    marginColor: m.margin === 'none' ? null : medianColor(img, marginPx),
    texture: detectTexture(img, pf.marked).texture,
  };
}
