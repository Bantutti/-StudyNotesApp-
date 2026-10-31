/**
 * Word error rate (WER) between a reference script and a transcript.
 * WER = (substitutions + deletions + insertions) / reference words.
 * Normalisation keeps Latin letters incl. accents (Tagalog/Cebuano, ñ) and
 * digits, lowercases, and treats hyphens as spaces. Explicit ranges are used
 * instead of \p{L} so the regex works on every JS engine (Hermes included).
 */
const LETTERS_ONLY = /[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF\s']/g;

export function normalizeWords(text: string): string[] {
  const lower = text.toLowerCase();
  const nfc = typeof lower.normalize === 'function' ? lower.normalize('NFC') : lower;
  return nfc
    .replace(/[-‐–—/]/g, ' ')
    .replace(LETTERS_ONLY, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

export interface WerResult {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  refWords: number;
  hypWords: number;
}

export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  const n = ref.length;
  const m = hyp.length;
  // dp[i][j] = [cost, subs, dels, ins]
  type Cell = [number, number, number, number];
  let prev: Cell[] = Array.from({ length: m + 1 }, (_, j) => [j, 0, 0, j] as Cell);
  for (let i = 1; i <= n; i++) {
    const cur: Cell[] = [[i, 0, i, 0]];
    for (let j = 1; j <= m; j++) {
      const same = ref[i - 1] === hyp[j - 1];
      const d = prev[j - 1] as Cell;
      const up = prev[j] as Cell;
      const left = cur[j - 1] as Cell;
      const sub: Cell = [d[0] + (same ? 0 : 1), d[1] + (same ? 0 : 1), d[2], d[3]];
      const del: Cell = [up[0] + 1, up[1], up[2] + 1, up[3]];
      const ins: Cell = [left[0] + 1, left[1], left[2], left[3] + 1];
      cur.push([sub, del, ins].reduce((a, b) => (b[0] < a[0] ? b : a)));
    }
    prev = cur;
  }
  const [cost, s, dl, ins] = prev[m] as Cell;
  return { wer: n > 0 ? cost / n : m > 0 ? 1 : 0, substitutions: s, deletions: dl, insertions: ins, refWords: n, hypWords: m };
}
