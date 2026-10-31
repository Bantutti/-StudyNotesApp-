/**
 * Materializer: flat AI blocks -> document nodes, keeping block ids.
 *
 * Id rules (ALGORITHMS §4.2, Rey Nov 1 Q5 = A):
 * - When the AI rewrites a unit, the FIRST output block inherits the unit's
 *   attrs (its block id and any other non-shape attribute, e.g. a future audio
 *   anchor). Shape attrs (heading level, definition term, list start) are
 *   replaced by the new block's shape.
 * - Paragraphs inside a rewritten callout / definition / list item reuse the
 *   old inner paragraphs' attrs by position, so cards pointing at an inner
 *   paragraph keep working while that paragraph still exists.
 * - Every other output node is created WITHOUT an id. Ids are assigned at
 *   apply time by core's ensureBlockIds, checked against the whole document
 *   for collisions (proposal/apply.ts). This file never writes an id itself.
 */
import type { DocNode } from '@/core';

import { parseInline, type ParseOptions } from './marks';
import { cloneNode, loose, typed, type LooseNode } from './nodes';
import type { AiBlockKind, Unit } from './units';

/** One block as the AI writes it (validated by actions/schemas.ts). */
export interface AiBlock {
  kind: AiBlockKind;
  term: string | null;
  text: string;
}

/** Attrs that describe a node's shape; never inherited across a rewrite. */
const SHAPE_KEYS = new Set(['level', 'term', 'start']);
export const MAX_TERM_CHARS = 200;

// Bidi overrides/isolates can make text read differently than it is stored.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Cleans untrusted AI text: CRLF -> LF, tabs -> spaces, control and bidi
 * override characters removed, 3+ newlines collapsed, ends trimmed.
 */
export function sanitizeAiText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Copies the original's non-shape attrs and adds the new shape. */
function inheritAttrs(orig: LooseNode | null, shape: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(orig?.attrs ?? {})) if (!SHAPE_KEYS.has(k)) out[k] = cloneNode(v);
  Object.assign(out, shape);
  return Object.keys(out).length > 0 ? out : undefined;
}

function withAttrs(type: string, attrs: Record<string, unknown> | undefined, content?: LooseNode[]): LooseNode {
  const n: LooseNode = { type };
  if (attrs) n.attrs = attrs;
  if (content && content.length > 0) n.content = content;
  return n;
}

/** A paragraph from marked text; `attrs` (if any) come from an old paragraph. */
function paragraph(text: string, attrs: Record<string, unknown> | undefined, opts: ParseOptions): LooseNode {
  return withAttrs('paragraph', attrs ? cloneNode(attrs) : undefined, parseInline(text, opts) as unknown as LooseNode[]);
}

/**
 * Splits text into paragraphs (one per non-empty line) for callouts and
 * definitions, reusing old inner paragraphs' attrs by position.
 */
function paragraphsFrom(text: string, oldParagraphs: readonly LooseNode[], opts: ParseOptions): LooseNode[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) lines.push('');
  return lines.map((line, i) => paragraph(line, oldParagraphs[i]?.attrs, { ...opts, allowBreaks: false }));
}

const HEADING_LEVEL: Partial<Record<AiBlockKind, 1 | 2 | 3>> = { heading1: 1, heading2: 2, heading3: 3 };

/** Builds one non-list top-level node. `orig` is the unit node it replaces, if inheriting. */
function topNode(b: AiBlock, orig: LooseNode | null, opts: ParseOptions): LooseNode {
  const text = sanitizeAiText(b.text);
  const oldParas = (orig?.content ?? []).filter((c) => c.type === 'paragraph');
  const level = HEADING_LEVEL[b.kind];
  if (level) {
    return withAttrs('heading', inheritAttrs(orig, { level }), parseInline(text, { ...opts, allowBreaks: false }) as unknown as LooseNode[]);
  }
  if (b.kind === 'callout') return withAttrs('callout', inheritAttrs(orig, {}), paragraphsFrom(text, oldParas, opts));
  if (b.kind === 'definition') {
    const term = sanitizeAiText(b.term ?? '').replace(/\n/g, ' ').slice(0, MAX_TERM_CHARS);
    if (term) return withAttrs('definition', inheritAttrs(orig, { term }), paragraphsFrom(text, oldParas, opts));
    // A definition without a term is just a paragraph.
  }
  // paragraph (and any kind we coerce to it)
  return withAttrs('paragraph', inheritAttrs(orig, {}), parseInline(text, opts) as unknown as LooseNode[]);
}

/** A new list item holding one paragraph. */
function listItem(text: string, itemAttrs: Record<string, unknown> | undefined, paraAttrs: Record<string, unknown> | undefined, opts: ParseOptions, nested: LooseNode[] = []): LooseNode {
  return withAttrs('listItem', itemAttrs, [paragraph(sanitizeAiText(text), paraAttrs, opts), ...nested]);
}

const isListKind = (k: AiBlockKind) => k === 'bullet' || k === 'numbered';

/**
 * Top-level context: turns blocks into top-level nodes, grouping runs of
 * consecutive bullet / numbered blocks into one new list. When `inherit` is
 * given, the first block inherits that unit's attrs (§4.2).
 */
export function materializeTop(blocks: readonly AiBlock[], inherit: Unit | null, opts: ParseOptions): DocNode[] {
  const out: LooseNode[] = [];
  const orig = inherit ? loose(inherit.node) : null;
  for (let i = 0; i < blocks.length; ) {
    const b = blocks[i] as AiBlock;
    if (!isListKind(b.kind)) {
      out.push(topNode(b, i === 0 ? orig : null, opts));
      i++;
      continue;
    }
    // Group consecutive blocks of the same list kind.
    const items: LooseNode[] = [];
    let j = i;
    while (j < blocks.length && (blocks[j] as AiBlock).kind === b.kind) {
      const blk = blocks[j] as AiBlock;
      if (j === 0 && orig) {
        // The original's id moves to the first list item (the text-bearing block).
        const firstPara = (orig.content ?? []).find((c) => c.type === 'paragraph');
        items.push(listItem(blk.text, inheritAttrs(orig, {}), firstPara?.attrs, opts));
      } else {
        items.push(listItem(blk.text, undefined, undefined, opts));
      }
      j++;
    }
    out.push(withAttrs(b.kind === 'bullet' ? 'bulletList' : 'orderedList', undefined, items));
    i = j;
  }
  return out.map(typed);
}

/**
 * List context: the unit is a listItem. The first block rewrites the item's
 * first paragraph and keeps the item's nested lists untouched; extra blocks
 * become new sibling items. Block kinds are ignored here: in a list every
 * block is a list item (documented coercion, ALGORITHMS §4.2).
 */
export function materializeListItems(blocks: readonly AiBlock[], inherit: Unit | null, opts: ParseOptions): DocNode[] {
  const out: LooseNode[] = [];
  blocks.forEach((b, i) => {
    if (i === 0 && inherit) {
      const orig = loose(inherit.node);
      const [firstPara, ...rest] = orig.content ?? [];
      const nested = rest.filter((c) => c.type === 'bulletList' || c.type === 'orderedList').map((c) => cloneNode(c));
      out.push(listItem(b.text, inheritAttrs(orig, {}), firstPara?.type === 'paragraph' ? firstPara.attrs : undefined, opts, nested));
    } else {
      out.push(listItem(b.text, undefined, undefined, opts));
    }
  });
  return out.map(typed);
}
