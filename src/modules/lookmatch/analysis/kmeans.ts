/**
 * Palette extraction by k-means in OKLab (MATCH_MATH.md §3).
 *
 * Input: N colour samples as a flat Float64Array [L0, a0, b0, L1, a1, b1, ...].
 * Output: up to k clusters (centre + share of the samples), largest first.
 *
 * Determinism matters: the same photo must always give the same pack, and
 * tests compare exact results. So the random choices of k-means++ come from
 * a seeded generator (§3.1), never from Math.random.
 */
import { deltaE, type Lab } from '../color/oklab';

/** One palette colour found in the photo. */
export interface Cluster {
  center: Lab;
  /** Share of all samples in this cluster, 0..1 (all clusters sum to 1). */
  weight: number;
}

export interface KMeansOptions {
  k: number;
  /** Seed for k-means++ (§3.1). Fixed per call site so results repeat. */
  seed: number;
  /** Lloyd iterations cap (§3.2). */
  maxIter?: number;
  /** Stop when no centre moved more than this (OKLab units, §3.2). */
  tolerance?: number;
  /** Clusters closer than this are merged afterwards (§3.3). */
  mergeBelow?: number;
}

/**
 * mulberry32: a tiny, fast, seeded 32-bit PRNG (§3.1). Not for security,
 * only for repeatable sampling. Returns floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Squared OKLab distance between sample i and centre c (no sqrt: only used for comparisons). */
function dist2(s: Float64Array, i: number, c: Lab): number {
  const dL = (s[i * 3] as number) - c.L;
  const da = (s[i * 3 + 1] as number) - c.a;
  const db = (s[i * 3 + 2] as number) - c.b;
  return dL * dL + da * da + db * db;
}

const sampleAt = (s: Float64Array, i: number): Lab => ({
  L: s[i * 3] as number,
  a: s[i * 3 + 1] as number,
  b: s[i * 3 + 2] as number,
});

/**
 * k-means++ seeding (§3.1): the first centre is a random sample; each next
 * centre is drawn with probability proportional to D(x)^2, the squared
 * distance to the nearest centre chosen so far. This spreads the starting
 * centres out, so small but distinct colours (a highlighter stripe) get a
 * centre instead of being swallowed by the paper.
 */
function seedCenters(s: Float64Array, n: number, k: number, rand: () => number): Lab[] {
  const centers: Lab[] = [sampleAt(s, Math.floor(rand() * n))];
  const d2 = new Float64Array(n).fill(Infinity);
  while (centers.length < k) {
    const last = centers[centers.length - 1] as Lab;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = dist2(s, i, last);
      if (d < (d2[i] as number)) d2[i] = d;
      total += d2[i] as number;
    }
    // Every sample already sits on a centre (e.g. a flat image): fewer clusters than k.
    if (total <= 0) break;
    let r = rand() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= d2[i] as number;
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    centers.push(sampleAt(s, pick));
  }
  return centers;
}

/**
 * Lloyd's algorithm (§3.2): assign every sample to its nearest centre, move
 * each centre to the mean of its samples, repeat until nothing moves more
 * than `tolerance` or `maxIter` rounds have run. Cost O(N * k * iter); with
 * N <= 16,384 samples, k = 8 and 20 rounds that is about 2.6M distance
 * checks, well under 100 ms on a phone.
 */
export function kmeans(samples: Float64Array, opts: KMeansOptions): Cluster[] {
  const n = Math.floor(samples.length / 3);
  if (n === 0) return [];
  const k = Math.max(1, Math.min(opts.k, n));
  const maxIter = opts.maxIter ?? 20;
  const tol = opts.tolerance ?? 1e-4;
  const rand = mulberry32(opts.seed);

  let centers = seedCenters(samples, n, k, rand);
  const assign = new Int32Array(n);
  for (let iter = 0; iter < maxIter; iter++) {
    // Assignment step.
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(samples, i, centers[c] as Lab);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    // Update step: running sums per centre.
    const sums = centers.map(() => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < n; i++) {
      const acc = sums[assign[i] as number] as { L: number; a: number; b: number; n: number };
      acc.L += samples[i * 3] as number;
      acc.a += samples[i * 3 + 1] as number;
      acc.b += samples[i * 3 + 2] as number;
      acc.n++;
    }
    let moved = 0;
    // An empty cluster keeps its old centre (it simply ends with weight 0 and is dropped).
    const next = centers.map((c, j) => {
      const acc = sums[j] as { L: number; a: number; b: number; n: number };
      if (acc.n === 0) return c;
      const m = { L: acc.L / acc.n, a: acc.a / acc.n, b: acc.b / acc.n };
      moved = Math.max(moved, deltaE(c, m));
      return m;
    });
    centers = next;
    if (moved < tol) break;
  }

  // Final counts with the converged centres.
  const counts = new Float64Array(centers.length);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const d = dist2(samples, i, centers[c] as Lab);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    counts[best] = (counts[best] as number) + 1;
  }
  const clusters = centers
    .map((center, j) => ({ center, weight: (counts[j] as number) / n }))
    .filter((c) => c.weight > 0);
  return mergeClose(clusters, opts.mergeBelow ?? 0.03);
}

/**
 * §3.3: merge clusters whose centres are closer than `threshold` (a
 * weight-averaged centre), so "two almost identical creams" become one
 * paper colour. Greedy, largest first; result sorted by weight, descending.
 */
export function mergeClose(clusters: Cluster[], threshold: number): Cluster[] {
  const sorted = [...clusters].sort((x, y) => y.weight - x.weight);
  const out: Cluster[] = [];
  for (const c of sorted) {
    const into = out.find((o) => deltaE(o.center, c.center) < threshold);
    if (!into) {
      out.push({ center: { ...c.center }, weight: c.weight });
      continue;
    }
    const w = into.weight + c.weight;
    into.center = {
      L: (into.center.L * into.weight + c.center.L * c.weight) / w,
      a: (into.center.a * into.weight + c.center.a * c.weight) / w,
      b: (into.center.b * into.weight + c.center.b * c.weight) / w,
    };
    into.weight = w;
  }
  return out.sort((x, y) => y.weight - x.weight);
}
