/**
 * Word diff for the AI preview (ALGORITHMS §2). Pure, no rendering.
 *
 * Output segments are plain text; the preview renders them in <Text>, which
 * never interprets markup, so AI text cannot inject anything here.
 */

export type DiffSegment = { kind: 'equal' | 'removed' | 'added'; text: string };

/** §2.3 Above this many words on either side, show the whole block as changed. */
export const MAX_DIFF_WORDS = 400;

/** §2.1 Tokens: non-space runs with their trailing spaces (joining them rebuilds the text). */
export function tokenize(text: string): string[] {
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const rest = text.slice(lead.length).match(/\S+\s*/g) ?? [];
  // Leading whitespace sticks to the first token so nothing is lost.
  if (lead && rest.length) rest[0] = lead + rest[0];
  else if (lead) return [lead];
  return rest;
}

/** Appends a segment, merging it into the previous one when the kind matches. */
function push(out: DiffSegment[], kind: DiffSegment['kind'], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push({ kind, text });
}

/**
 * §2.2 LCS word diff. Returns one script covering both sides:
 * before = equal + removed, after = equal + added.
 */
export function wordDiff(before: string, after: string): DiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const out: DiffSegment[] = [];
  if (before === after) {
    push(out, 'equal', before);
    return out;
  }
  // §2.3 Cost cap: whole-block fallback.
  if (a.length > MAX_DIFF_WORDS || b.length > MAX_DIFF_WORDS) {
    push(out, 'removed', before);
    push(out, 'added', after);
    return out;
  }
  const n = a.length;
  const m = b.length;
  const W = m + 1; // row width of the flat table
  // L[i][j] = LCS length of a[i..] and b[j..]; stored flat, row-major (§2.3).
  const L = new Uint16Array((n + 1) * W);
  const same = (i: number, j: number) => (a[i] as string).trim() === (b[j] as string).trim();
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = same(i, j)
        ? (L[(i + 1) * W + j + 1] as number) + 1
        : Math.max(L[(i + 1) * W + j] as number, L[i * W + j + 1] as number);
    }
  }
  // Forward walk (§2.2).
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(i, j)) {
      // Show the AFTER token for equal words, so changed spacing reads as the new text.
      push(out, 'equal', b[j] as string);
      i++;
      j++;
    } else if ((L[(i + 1) * W + j] as number) >= (L[i * W + j + 1] as number)) {
      push(out, 'removed', a[i++] as string);
    } else {
      push(out, 'added', b[j++] as string);
    }
  }
  while (i < n) push(out, 'removed', a[i++] as string);
  while (j < m) push(out, 'added', b[j++] as string);
  return out;
}

/** The "before" side of a script (equal + removed). */
export const beforeSide = (s: readonly DiffSegment[]) => s.filter((x) => x.kind !== 'added');
/** The "after" side of a script (equal + added). */
export const afterSide = (s: readonly DiffSegment[]) => s.filter((x) => x.kind !== 'removed');
