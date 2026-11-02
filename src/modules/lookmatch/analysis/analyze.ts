/**
 * The on-device pass for one to three reference images (MATCH_MATH.md §2-§6).
 * Pure: pixels in, a LookAnalysis out. No network, no key, works for
 * everyone (P5 brief: "an on-device pass that works for everyone").
 *
 * Multi-image merge (§6, decision Q4 = A): every image contributes the SAME
 * number of colour samples, so a large photo can't outvote a small one; the
 * pooled samples are clustered once. The paper pattern is measured per
 * image and decided by vote (ties: the first image, which the student
 * picked first); the line gap is the median of the agreeing images.
 */
import { assignRoles, type HighlighterGuess } from './roles';
import { kmeans } from './kmeans';
import { lineGapFromRatio, analyzePattern, type PaperMargin, type PaperType, type PatternResult, type Texture } from './pattern';
import { median, sampleLab, toLabImage, type RgbaImage } from './pixels';

/** Colour samples per image (§2.3): 6,000 x 3 images x k=10 x 20 rounds stays well under 100 ms. */
export const SAMPLES_PER_IMAGE = 6_000;
/**
 * Clusters (§3): paper, ink, accent(s), up to 4 highlighters, pattern, margin, plus slack for
 * shading and anti-aliasing. Too few and pale highlighters get absorbed into the paper; near
 * duplicates are merged afterwards (§3.3), so a generous k costs only time.
 */
export const PALETTE_K = 14;
/** Fixed k-means++ seed (§3.1), so the same photos always give the same look. */
export const PALETTE_SEED = 0x5eed;

export interface LookAnalysis {
  imageCount: number;
  appearance: 'light' | 'dark';
  paper: {
    color: string;
    /** Pattern colour (§5.7), null when plain or unknown. */
    line: string | null;
    type: PaperType;
    /** Schema lineGap (22-34) from the spacing (§5.4), null when plain. */
    lineGap: number | null;
    margin: PaperMargin;
    marginColor: string | null;
    texture: Texture;
  };
  ink: string;
  accent: string | null;
  accent2: string | null;
  highlighters: HighlighterGuess[];
  swatches: { hex: string; weight: number }[];
  /** 0..1 per decision, shown as strong or weak chips (M5). */
  confidence: { paperType: number; agreement: number };
}

/** §6.2 majority vote; ties go to the earliest image. */
function vote<T>(values: readonly T[]): { value: T; count: number } {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] as T;
  let bestN = 0;
  for (const v of values) {
    const n = counts.get(v) as number;
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return { value: best, count: bestN };
}

export function analyzeImages(images: readonly RgbaImage[]): LookAnalysis {
  if (images.length === 0) throw new Error('no_images');
  const labs = images.map(toLabImage);
  return combine(images.length, labs, labs.map(analyzePattern));
}

/** §6: pooled palette, voted pattern, roles. Shared by the sync and async entry points. */
function combine(count: number, labs: readonly ReturnType<typeof toLabImage>[], patterns: readonly PatternResult[]): LookAnalysis {
  // §6.1 equal samples per image, pooled.
  const parts = labs.map((l) => sampleLab(l, SAMPLES_PER_IMAGE));
  const pooled = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    pooled.set(p, o);
    o += p.length;
  }
  const clusters = kmeans(pooled, { k: PALETTE_K, seed: PALETTE_SEED });

  // §6.2 pattern by vote; colours of the pattern and margin are excluded from roles (§4.5).
  const type = vote(patterns.map((p) => p.type));
  const agreeing = patterns.filter((p) => p.type === type.value);
  const ratios = agreeing.map((p) => p.periodRatio).filter((r): r is number => r !== null);
  const margin = vote(patterns.map((p) => p.margin)).value;
  const texture = vote(patterns.map((p) => p.texture)).value;
  const line = agreeing.find((p) => p.lineColor)?.lineColor ?? null;
  const marginColor = patterns.find((p) => p.margin === margin && p.marginColor)?.marginColor ?? null;
  const roles = assignRoles(clusters, { pattern: line, margin: margin === 'none' ? null : marginColor });

  return {
    imageCount: count,
    appearance: roles.appearance,
    paper: {
      color: roles.paper,
      line,
      type: type.value,
      lineGap: type.value === 'plain' || ratios.length === 0 ? null : lineGapFromRatio(median(ratios), 28),
      margin,
      marginColor: margin === 'none' ? null : marginColor,
      texture,
    },
    ink: roles.ink,
    accent: roles.accent,
    accent2: roles.accent2,
    highlighters: roles.highlighters,
    swatches: roles.swatches,
    confidence: {
      paperType: Math.round((agreeing.reduce((n, p) => n + p.confidence, 0) / agreeing.length) * 100) / 100,
      agreement: Math.round((type.count / count) * 100) / 100,
    },
  };
}

/** Progress of the async pass, for the Match a look screen (no image data in it). */
export type AnalyzeProgress = { stage: 'reading' | 'pattern' | 'palette' | 'done'; image: number; images: number };

/**
 * Same result as analyzeImages, but yields to the UI thread between images
 * and stages (one macrotask each), so the screen stays responsive on slow
 * phones (Hermes has no JIT; UNVERIFIED budget: under 2 s for 3 photos on a
 * mid-range Android) and the student can cancel.
 */
export async function analyzeImagesAsync(
  images: readonly RgbaImage[],
  opts: { onProgress?: (p: AnalyzeProgress) => void; signal?: AbortSignal; yieldFn?: () => Promise<void> } = {},
): Promise<LookAnalysis> {
  const pause = opts.yieldFn ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const check = () => {
    if (opts.signal?.aborted) throw new Error('cancelled');
  };
  if (images.length === 0) throw new Error('no_images');
  const labs: ReturnType<typeof toLabImage>[] = [];
  const patterns: PatternResult[] = [];
  for (const [i, img] of images.entries()) {
    opts.onProgress?.({ stage: 'reading', image: i + 1, images: images.length });
    await pause();
    check();
    const lab = toLabImage(img);
    labs.push(lab);
    opts.onProgress?.({ stage: 'pattern', image: i + 1, images: images.length });
    await pause();
    check();
    patterns.push(analyzePattern(lab));
  }
  opts.onProgress?.({ stage: 'palette', image: images.length, images: images.length });
  await pause();
  check();
  const result = combine(images.length, labs, patterns);
  opts.onProgress?.({ stage: 'done', image: images.length, images: images.length });
  return result;
}
