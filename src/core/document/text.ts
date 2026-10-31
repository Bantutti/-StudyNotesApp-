/**
 * Plain-text views of a note document, used by search (FTS5 rows per block),
 * word counts and Beautify Lite. Pure functions; no rendering.
 */
import { getBlockId } from './blockIds';
import type { DocNode, NoteDoc } from './schema';

export type TextBlockKind = 'text' | 'heading' | 'term';

export interface TextBlock {
  /** The block id of the text block (or its nearest ancestor with one). */
  blockId: string | null;
  kind: TextBlockKind;
  text: string;
}

const isInline = (n: DocNode): boolean => n.type === 'text' || n.type === 'hardBreak';

/** Concatenates a node's direct inline children (hardBreak -> space). */
export function inlineText(node: DocNode): string {
  if (!('content' in node) || !node.content) return '';
  let s = '';
  for (const c of node.content) {
    if (c.type === 'text') s += c.text;
    else if (c.type === 'hardBreak') s += ' ';
  }
  return s;
}

/**
 * Every block that carries its own text, in document order. Definition terms
 * become their own "term" rows so a search for the term opens its box.
 */
export function extractTextBlocks(doc: NoteDoc): TextBlock[] {
  const out: TextBlock[] = [];
  const walk = (nodes: readonly DocNode[], inherited: string | null) => {
    for (const n of nodes) {
      const id = getBlockId(n) ?? inherited;
      if (n.type === 'definition' && n.attrs.term.trim()) {
        out.push({ blockId: id, kind: 'term', text: n.attrs.term.trim() });
      }
      if ('content' in n && n.content) {
        if (n.content.some(isInline)) {
          const text = inlineText(n).replace(/\s+/g, ' ').trim();
          if (text) out.push({ blockId: id, kind: n.type === 'heading' ? 'heading' : 'text', text });
        }
        walk(n.content.filter((c) => !isInline(c)), id);
      }
    }
  };
  walk(doc.content, null);
  return out;
}

/** Words in the note (title not included). */
export function countWords(doc: NoteDoc): number {
  let words = 0;
  for (const b of extractTextBlocks(doc)) {
    const m = b.text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
    words += m ? m.length : 0;
  }
  return words;
}

/** First non-empty line, for untitled notes ("Untitled" fallback is the UI's). */
export function firstLine(doc: NoteDoc, max = 80): string {
  const first = extractTextBlocks(doc)[0]?.text ?? '';
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
