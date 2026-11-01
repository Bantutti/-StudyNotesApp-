/**
 * Beautify Lite: on-device, rule-based tidy-up (plan F5, decision Q8 = B).
 *
 * Guarantees (all tested):
 *  - Never changes the student's words. It only restructures and formats:
 *    list markers ("- ", "1.") and the "::" / " - " definition separators
 *    and Q:/A: labels become structure, and a heading loses a trailing ":".
 *    The only text it ADDS is the "Key terms" section (copies of terms).
 *  - Block ids: the block carrying a line's text keeps that line's id
 *    (list item paragraphs, callout and Q&A text); a line that becomes a
 *    definition box gives the BOX its id (cards point at definition boxes).
 *    New wrappers get fresh ids. Existing structured blocks are untouched.
 *  - Idempotent: running it twice gives the same document as running once.
 *  - Pure: no I/O; output passes the note schema.
 *
 * Rules, applied to top-level paragraphs only (columns, tables, callouts
 * and existing structure are left alone):
 *  1. "- x", "* x", "• x"          -> bullet list (consecutive lines merge)
 *  2. "1. x", "1) x"                -> numbered list (keeps the first number)
 *  3. "Q: ..." followed by "A: ..." -> Q&A block
 *  4. "Note:", "Tip:", "Important:", "Exam:", "Remember:", "Warning:" -> callout
 *  5. "Term :: meaning" (up to 6 words) or "Term - meaning" (up to 4 words,
 *     not a sentence or maths) -> definition box
 *  6. Short line ending with ":" or in CAPITALS (up to 8 words) -> heading (level 2)
 *  7. Runs of empty lines collapse to one; empty lines at the end are removed
 *  8. Bold text anywhere gets the pack's first highlighter ("Key idea")
 *  9. A "Key terms" list at the end (definition terms + bold terms), refreshed, never duplicated
 */
import {
  ensureBlockIds,
  getBlockId,
  inlineText,
  type DocNode,
  type IdGenerator,
  type Mark,
  type NoteDoc,
} from '@/core';

export const KEY_TERMS_TITLE = 'Key terms';
const MAX_TERMS = 30;
const MAX_TERM_LEN = 60;

export interface BeautifyReport {
  changed: boolean;
  headings: number;
  definitions: number;
  lists: number;
  callouts: number;
  qa: number;
  highlights: number;
  blanksRemoved: number;
  keyTerms: number;
}

type Para = Extract<DocNode, { type: 'paragraph' }>;
type Inline = DocNode; // text | hardBreak

const BULLET = /^\s*[-*•‣◦]\s+/;
const NUMBER = /^\s*(\d{1,3})[.)]\s+/;
const QUESTION = /^\s*Q\s*[:.)]\s*/i;
const ANSWER = /^\s*A\s*[:.)]\s*/i;
const CALLOUT = /^\s*(note|tip|important|exam|remember|warning)\s*[:!]/i;
const DEF = /^(.+?)\s*(::|\s[-–—]\s)\s*(.+)$/;
/** Words that make the left side a sentence, not a term ("I went home - ..."). */
const NOT_A_TERM = /^(i|we|you|he|she|it|they|this|that|there)\b|\b(is|are|was|were|am|be|been|has|have|had|do|does|did)\b/i;

const isPara = (n: DocNode): n is Para => n.type === 'paragraph';
const inl = (p: Para): Inline[] => p.content ?? [];
const textOf = (p: Para) => inlineText(p);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Drops the first `count` characters of an inline run (keeps marks on the rest). */
export function dropChars(nodes: readonly Inline[], count: number): Inline[] {
  let left = count;
  const out: Inline[] = [];
  for (const n of nodes) {
    if (left <= 0) {
      out.push(n);
      continue;
    }
    if (n.type === 'hardBreak') {
      left -= 1;
      continue;
    }
    if (n.type !== 'text') continue;
    if (n.text.length <= left) {
      left -= n.text.length;
      continue;
    }
    out.push({ ...n, text: n.text.slice(left) });
    left = 0;
  }
  return trimStart(out);
}

/** Drops trailing characters (used for a heading's final ":"). */
function dropEnd(nodes: readonly Inline[], count: number): Inline[] {
  const out = [...nodes];
  let left = count;
  while (left > 0 && out.length) {
    const last = out[out.length - 1] as Inline;
    if (last.type !== 'text') {
      out.pop();
      left -= 1;
      continue;
    }
    if (last.text.length <= left) {
      out.pop();
      left -= last.text.length;
    } else {
      out[out.length - 1] = { ...last, text: last.text.slice(0, last.text.length - left) };
      left = 0;
    }
  }
  return trimEnd(out);
}

function trimStart(nodes: Inline[]): Inline[] {
  const out = [...nodes];
  while (out[0]?.type === 'text' && /^\s/.test(out[0].text)) {
    const t = out[0].text.replace(/^\s+/, '');
    if (t) out[0] = { ...out[0], text: t };
    else out.shift();
  }
  return out;
}

function trimEnd(nodes: Inline[]): Inline[] {
  const out = [...nodes];
  for (;;) {
    const last = out[out.length - 1];
    if (last?.type !== 'text' || !/\s$/.test(last.text)) break;
    const t = last.text.replace(/\s+$/, '');
    if (t) out[out.length - 1] = { ...last, text: t };
    else out.pop();
  }
  return out;
}

const keepId = (p: Para) => ({ blockId: getBlockId(p) });
const paraWith = (content: Inline[], attrs?: { blockId: string | null }): Para => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});

function isHeadingLine(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 60 || words(t) > 8) return false;
  if (/[.?!]$/.test(t)) return false;
  if (t.endsWith(':')) return t.length > 1;
  const letters = t.replace(/[^\p{L}]/gu, '');
  return letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/**
 * "Term :: meaning" (explicit, up to 6 words) or "Term - meaning" (a spaced
 * dash is ambiguous, so stricter: up to 4 words, not a sentence, not maths).
 */
function definitionParts(text: string): { term: string; restStart: number } | null {
  const m = DEF.exec(text);
  if (!m) return null;
  const term = (m[1] ?? '').trim();
  const explicit = (m[2] ?? '').trim() === '::';
  const rest = m[3] ?? '';
  if (!term || !rest.trim() || term.length > MAX_TERM_LEN || /[.?!:;]/.test(term)) return null;
  if (BULLET.test(text) || NUMBER.test(text)) return null;
  if (words(term) > (explicit ? 6 : 4)) return null;
  if (!explicit && (NOT_A_TERM.test(term) || (/\d$/.test(term) && /^\d/.test(rest.trim())))) return null;
  return { term, restStart: text.length - rest.length };
}

interface Ctx {
  report: BeautifyReport;
}

/** Rules 1-7 over the top-level blocks. */
function restructure(blocks: readonly DocNode[], ctx: Ctx): DocNode[] {
  const out: DocNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const n = blocks[i] as DocNode;
    if (!isPara(n)) {
      out.push(n);
      i++;
      continue;
    }
    const text = textOf(n);

    // 7. empty lines: keep one in a run
    if (!text.trim()) {
      const prev = out[out.length - 1];
      if (prev && isPara(prev) && !textOf(prev).trim()) ctx.report.blanksRemoved++;
      else out.push(n);
      i++;
      continue;
    }

    // 1. bullets / 2. numbered (merge consecutive lines)
    const listKind = BULLET.test(text) ? 'bulletList' : NUMBER.test(text) ? 'orderedList' : null;
    if (listKind) {
      const items: DocNode[] = [];
      const start = listKind === 'orderedList' ? Number(NUMBER.exec(text)?.[1] ?? 1) : 1;
      const re = listKind === 'bulletList' ? BULLET : NUMBER;
      while (i < blocks.length) {
        const b = blocks[i] as DocNode;
        if (!isPara(b)) break;
        const m = re.exec(textOf(b));
        if (!m) break;
        items.push({ type: 'listItem', content: [paraWith(dropChars(inl(b), m[0].length), keepId(b))] });
        i++;
      }
      out.push(
        listKind === 'orderedList'
          ? { type: 'orderedList', ...(start !== 1 ? { attrs: { start } } : {}), content: items }
          : { type: 'bulletList', content: items },
      );
      ctx.report.lists++;
      continue;
    }

    // 3. Q: / A: pairs
    const next = blocks[i + 1];
    if (QUESTION.test(text) && next && isPara(next) && ANSWER.test(textOf(next))) {
      const q = QUESTION.exec(text)?.[0].length ?? 0;
      const a = ANSWER.exec(textOf(next))?.[0].length ?? 0;
      out.push({
        type: 'qa',
        content: [
          { type: 'qaQuestion', attrs: keepId(n), content: dropChars(inl(n), q) },
          { type: 'qaAnswer', content: [paraWith(dropChars(inl(next), a), keepId(next))] },
        ],
      });
      ctx.report.qa++;
      i += 2;
      continue;
    }

    // 4. callouts (the label stays: no words removed)
    if (CALLOUT.test(text)) {
      out.push({ type: 'callout', content: [paraWith(inl(n), keepId(n))] });
      ctx.report.callouts++;
      i++;
      continue;
    }

    // 5. definitions: the box takes the line's id
    const def = definitionParts(text);
    if (def) {
      out.push({
        type: 'definition',
        attrs: { term: def.term, blockId: getBlockId(n) },
        content: [paraWith(dropChars(inl(n), def.restStart))],
      });
      ctx.report.definitions++;
      i++;
      continue;
    }

    // 6. headings
    if (isHeadingLine(text)) {
      const content = text.trim().endsWith(':') ? dropEnd(trimEnd(inl(n)), 1) : trimEnd(inl(n));
      out.push({ type: 'heading', attrs: { level: 2, blockId: getBlockId(n) }, content });
      ctx.report.headings++;
      i++;
      continue;
    }

    out.push(n);
    i++;
  }
  // 7. no empty lines at the end (keep at least one block)
  while (out.length > 1) {
    const last = out[out.length - 1] as DocNode;
    if (!isPara(last) || textOf(last).trim()) break;
    out.pop();
    ctx.report.blanksRemoved++;
  }
  return out;
}

/** 8. bold -> highlight k0 (skips headings and text already highlighted). */
function highlightBold(nodes: readonly DocNode[], ctx: Ctx, inHeading = false): DocNode[] {
  return nodes.map((n) => {
    if (n.type === 'text') {
      const marks = n.marks ?? [];
      if (inHeading || !marks.some((m) => m.type === 'bold') || marks.some((m) => m.type === 'highlight')) return n;
      ctx.report.highlights++;
      const hl: Mark = { type: 'highlight', attrs: { key: 'k0' } };
      return { ...n, marks: [...marks, hl] };
    }
    if ('content' in n && n.content) {
      return { ...n, content: highlightBold(n.content, ctx, inHeading || n.type === 'heading') } as DocNode;
    }
    return n;
  });
}

/** Finds an existing Key terms section at the very end: [heading, bulletList?]. */
function keyTermsSection(blocks: readonly DocNode[]): { start: number; list: DocNode | null } | null {
  for (let i = blocks.length - 1; i >= Math.max(0, blocks.length - 2); i--) {
    const b = blocks[i] as DocNode;
    if (b.type === 'heading' && b.attrs.level === 2 && inlineText(b).trim() === KEY_TERMS_TITLE) {
      const after = blocks.slice(i + 1);
      if (after.length === 0) return { start: i, list: null };
      if (after.length === 1 && after[0]?.type === 'bulletList') return { start: i, list: after[0] };
      return null;
    }
  }
  return null;
}

function collectTerms(blocks: readonly DocNode[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const t = raw.replace(/\s+/g, ' ').trim().replace(/[:;,.]$/, '');
    const k = t.toLocaleLowerCase();
    if (!t || t.length > MAX_TERM_LEN || seen.has(k) || out.length >= MAX_TERMS) return;
    seen.add(k);
    out.push(t);
  };
  const walk = (nodes: readonly DocNode[], inHeading: boolean) => {
    for (const n of nodes) {
      if (n.type === 'definition') add(n.attrs.term);
      if (n.type === 'text' && !inHeading && n.marks?.some((m) => m.type === 'bold')) add(n.text);
      if ('content' in n && n.content) walk(n.content, inHeading || n.type === 'heading');
    }
  };
  walk(blocks, false);
  return out;
}

/** 9. Key terms list: refreshed in place, item ids kept for unchanged terms. */
function refreshKeyTerms(blocks: DocNode[], ctx: Ctx): DocNode[] {
  const section = keyTermsSection(blocks);
  const body = section ? blocks.slice(0, section.start) : blocks;
  const terms = collectTerms(body);
  ctx.report.keyTerms = terms.length;
  if (terms.length === 0) return blocks; // nothing to list; leave any existing section alone
  const oldItems = new Map<string, DocNode>();
  for (const item of section?.list && 'content' in section.list ? section.list.content ?? [] : []) {
    const p = 'content' in item ? item.content?.[0] : undefined;
    if (p) oldItems.set(inlineText(p).trim().toLocaleLowerCase(), item);
  }
  const items = terms.map(
    (t) => oldItems.get(t.toLocaleLowerCase()) ?? ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } as DocNode),
  );
  const heading: DocNode = section
    ? (blocks[section.start] as DocNode)
    : { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: KEY_TERMS_TITLE }] };
  const list: DocNode = section?.list ? { ...section.list, content: items } as DocNode : { type: 'bulletList', content: items };
  return [...body, heading, list];
}

export function beautifyLite(doc: NoteDoc, ids: IdGenerator): { doc: NoteDoc; report: BeautifyReport } {
  const ctx: Ctx = {
    report: { changed: false, headings: 0, definitions: 0, lists: 0, callouts: 0, qa: 0, highlights: 0, blanksRemoved: 0, keyTerms: 0 },
  };
  let blocks = restructure(doc.content, ctx);
  blocks = highlightBold(blocks, ctx);
  blocks = refreshKeyTerms(blocks, ctx);
  const out = ensureBlockIds({ type: 'doc', content: blocks }, ids);
  ctx.report.changed = JSON.stringify(out) !== JSON.stringify(doc);
  return { doc: out, report: ctx.report };
}
