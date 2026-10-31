/**
 * Inline-mark codec between document text nodes and the plain strings the
 * AI reads and writes. Maths and rules: ALGORITHMS.md §5.
 *
 *   **bold**   *italic*   ==highlight==   ~~strike~~   ++underline++
 *
 * Why not Markdown or HTML: the AI must never be able to produce links, raw
 * HTML, attributes or styles (Plan §13, §17). This codec can only produce the
 * five marks above plus line breaks. Links are NOT in the codec: an AI string
 * can never create one. A link survives a rewrite only if its exact link text
 * is still present, and then its href comes from the user's original note
 * (§5.3), never from the AI.
 */
import { DOC_LIMITS, type DocNode, type HighlightKey, type Mark } from '@/core';

import { loose, type LooseNode } from './nodes';

type Marker = '**' | '*' | '==' | '~~' | '++';
type MarkName = 'bold' | 'italic' | 'highlight' | 'strike' | 'underline';

/** Outer-to-inner wrapping order when rendering (§5.1). */
const RENDER_ORDER: { mark: MarkName; marker: Marker }[] = [
  { mark: 'bold', marker: '**' },
  { mark: 'italic', marker: '*' },
  { mark: 'highlight', marker: '==' },
  { mark: 'strike', marker: '~~' },
  { mark: 'underline', marker: '++' },
];
const MARK_OF: Record<Marker, MarkName> = { '**': 'bold', '*': 'italic', '==': 'highlight', '~~': 'strike', '++': 'underline' };

export interface LinkRef {
  text: string;
  href: string;
}

export interface RenderedInline {
  text: string;
  /** Links in the original, so a rewrite can keep them (§5.3). */
  links: LinkRef[];
  /** The highlight colour key most used in the original, for new highlights. */
  highlightKey: HighlightKey | null;
}

// ---------------------------------------------------------------------------
// §5.1 Render: text nodes -> marked string
// ---------------------------------------------------------------------------

/**
 * Escapes characters that would otherwise read as markers:
 * every backslash and asterisk, and '=', '~', '+' when doubled.
 */
export function escapeInline(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c === '\\' || c === '*') out += `\\${c}`;
    else if ((c === '=' || c === '~' || c === '+') && (s[i + 1] === c || s[i - 1] === c)) out += `\\${c}`;
    else out += c;
  }
  return out;
}

/** Renders inline content (text + hardBreak nodes) to the marked string. */
export function renderInline(content: readonly DocNode[] | undefined): RenderedInline {
  const links: LinkRef[] = [];
  const hlCount = new Map<HighlightKey, number>();
  let text = '';
  for (const node of content ?? []) {
    const n = loose(node);
    if (n.type === 'hardBreak') {
      text += '\n';
      continue;
    }
    if (n.type !== 'text' || typeof n.text !== 'string') continue;
    const marks = (n.marks ?? []) as Mark[];
    const names = new Set<string>(marks.map((m) => m.type));
    for (const m of marks) {
      if (m.type === 'link') links.push({ text: n.text, href: m.attrs.href });
      if (m.type === 'highlight') hlCount.set(m.attrs.key, (hlCount.get(m.attrs.key) ?? 0) + 1);
    }
    let piece = escapeInline(n.text);
    // Wrap inner-most first so the outer marker ends up outside.
    for (let i = RENDER_ORDER.length - 1; i >= 0; i--) {
      const r = RENDER_ORDER[i] as { mark: MarkName; marker: Marker };
      if (names.has(r.mark)) piece = `${r.marker}${piece}${r.marker}`;
    }
    text += piece;
  }
  let highlightKey: HighlightKey | null = null;
  let best = 0;
  for (const [k, c] of hlCount) {
    if (c > best) {
      best = c;
      highlightKey = k;
    }
  }
  return { text, links, highlightKey };
}

// ---------------------------------------------------------------------------
// §5.2 Parse: marked string -> text nodes
// ---------------------------------------------------------------------------

type Token = { t: 'text'; v: string } | { t: 'br' } | { t: 'm'; v: Marker[] };

/** Splits a string into text, line-break and marker tokens (§5.2 step 1). */
export function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  for (let i = 0; i < s.length; ) {
    const c = s[i] as string;
    if (c === '\\' && i + 1 < s.length) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '\n') {
      flush();
      out.push({ t: 'br' });
      i++;
      continue;
    }
    if (c === '*') {
      let n = 0;
      while (s[i + n] === '*') n++;
      // Run of n stars: pairs of '**', plus one '*' when n is odd.
      // "***" therefore toggles bold AND italic in one token (§5.2).
      const ms: Marker[] = [];
      for (let k = 0; k < Math.floor(n / 2); k++) ms.push('**');
      if (n % 2 === 1) ms.push('*');
      flush();
      out.push({ t: 'm', v: ms });
      i += n;
      continue;
    }
    if ((c === '=' || c === '~' || c === '+') && s[i + 1] === c) {
      flush();
      out.push({ t: 'm', v: [`${c}${c}` as Marker] });
      i += 2;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Marker literal text, used when a marker turns out to be unmatched. */
const literal = (ms: Marker[]): string => ms.join('');

export interface ParseOptions {
  links?: readonly LinkRef[];
  highlightKey?: HighlightKey | null;
  /** Headings have no line breaks: '\n' becomes a space. */
  allowBreaks?: boolean;
}

/**
 * Parses a marked string into text and hardBreak nodes.
 * §5.2 toggle semantics: each marker flips its mark on/off. A marker type
 * that appears an odd number of times has its LAST occurrence unmatched; that
 * one is kept as literal text. Overlap ("**a *b** c*") is fine: marks are a
 * set per text node, not a tree.
 */
export function parseInline(input: string, opts: ParseOptions = {}): DocNode[] {
  const allowBreaks = opts.allowBreaks ?? true;
  const tokens = tokenize(input);

  // Step 2: find the unmatched (last odd) occurrence of each marker type.
  const count = new Map<Marker, number>();
  for (const tk of tokens) if (tk.t === 'm') for (const m of tk.v) count.set(m, (count.get(m) ?? 0) + 1);
  const unmatched = new Map<Marker, number>(); // marker -> occurrence index to treat as literal
  for (const [m, c] of count) if (c % 2 === 1) unmatched.set(m, c - 1);

  // Step 3: walk tokens with an active mark set.
  const active = new Set<MarkName>();
  const seen = new Map<Marker, number>();
  const runs: { text: string; marks: MarkName[] }[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const marks = [...active].sort();
    const last = runs[runs.length - 1];
    if (last && last.text !== '\n' && last.marks.join() === marks.join()) last.text += text;
    else runs.push({ text, marks });
  };
  for (const tk of tokens) {
    if (tk.t === 'text') pushText(tk.v);
    else if (tk.t === 'br') {
      if (allowBreaks) runs.push({ text: '\n', marks: [] });
      else pushText(' ');
    } else {
      for (const m of tk.v) {
        const i = seen.get(m) ?? 0;
        seen.set(m, i + 1);
        if (unmatched.get(m) === i) {
          pushText(literal([m]));
          continue;
        }
        const name = MARK_OF[m];
        if (active.has(name)) active.delete(name);
        else active.add(name);
      }
    }
  }

  // Step 4: runs -> nodes, re-applying the original links (§5.3).
  const out: DocNode[] = [];
  for (const run of runs) {
    if (run.text === '\n') {
      out.push({ type: 'hardBreak' });
      continue;
    }
    for (const piece of splitByLinks(run.text, opts.links ?? [])) {
      out.push(textNode(piece.text, run.marks, opts.highlightKey ?? 'k0', piece.href));
    }
  }
  return trimBreaks(out);
}

/** Builds one text node; marks are emitted in a fixed order. */
function textNode(text: string, names: MarkName[], hlKey: HighlightKey, href: string | null): DocNode {
  const marks: Mark[] = [];
  if (names.includes('bold')) marks.push({ type: 'bold' });
  if (names.includes('italic')) marks.push({ type: 'italic' });
  if (names.includes('underline')) marks.push({ type: 'underline' });
  if (names.includes('strike')) marks.push({ type: 'strike' });
  if (names.includes('highlight')) marks.push({ type: 'highlight', attrs: { key: hlKey } });
  if (href) marks.push({ type: 'link', attrs: { href } });
  const clipped = text.slice(0, DOC_LIMITS.maxTextLength);
  return marks.length > 0 ? { type: 'text', text: clipped, marks } : { type: 'text', text: clipped };
}

/**
 * §5.3 Splits text around exact occurrences of original link texts
 * (longest first, at least 2 characters). Hrefs come only from the original.
 */
export function splitByLinks(text: string, links: readonly LinkRef[]): { text: string; href: string | null }[] {
  const usable = [...links].filter((l) => l.text.length >= 2).sort((a, b) => b.text.length - a.text.length);
  let parts: { text: string; href: string | null }[] = [{ text, href: null }];
  for (const link of usable) {
    const next: { text: string; href: string | null }[] = [];
    for (const p of parts) {
      if (p.href !== null) {
        next.push(p);
        continue;
      }
      const segs = p.text.split(link.text);
      segs.forEach((seg, i) => {
        if (seg) next.push({ text: seg, href: null });
        if (i < segs.length - 1) next.push({ text: link.text, href: link.href });
      });
    }
    parts = next;
  }
  return parts.filter((p) => p.text.length > 0);
}

/** Leading/trailing hardBreaks add nothing; drop them. */
function trimBreaks(nodes: DocNode[]): DocNode[] {
  let a = 0;
  let b = nodes.length;
  while (a < b && (nodes[a] as DocNode).type === 'hardBreak') a++;
  while (b > a && (nodes[b - 1] as DocNode).type === 'hardBreak') b--;
  return nodes.slice(a, b);
}

/** Plain text of a marked string (markers removed), for comparisons. */
export function plainOf(marked: string): string {
  return parseInline(marked)
    .map((n) => {
      const l = loose(n) as LooseNode;
      return l.type === 'hardBreak' ? '\n' : (l.text ?? '');
    })
    .join('');
}
