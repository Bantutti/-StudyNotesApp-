/**
 * Plain display text for one block (ALGORITHMS §2.4). The preview never
 * renders HTML; it shows the text a block holds and a short kind label.
 * Marks are not shown here but are kept exactly in the applied document.
 */
import type { DocNode } from '@/core';

export interface BlockView {
  /** Short label for the block kind ("Heading", "Definition", ...). */
  label: string;
  text: string;
}

const LABELS: Partial<Record<DocNode['type'], string>> = {
  paragraph: 'Text',
  bulletList: 'List',
  orderedList: 'Numbered list',
  listItem: 'List item',
  callout: 'Callout',
  definition: 'Definition',
  blockquote: 'Quote',
  summary: 'Summary',
  qa: 'Q&A',
  columns: 'Columns',
  table: 'Table',
  horizontalRule: 'Divider',
};

/** Recursively collects text: inline runs joined, blocks on new lines. */
function textOf(node: DocNode, depth: number, out: string[], listMark: string | null): void {
  if (node.type === 'text') return; // handled by the parent's inline pass
  if (node.type === 'horizontalRule') {
    out.push('———');
    return;
  }
  const kids = 'content' in node && node.content ? node.content : [];
  const inline = kids.filter((c) => c.type === 'text' || c.type === 'hardBreak');
  if (inline.length) {
    let s = '';
    for (const c of inline) s += c.type === 'text' ? c.text : '\n';
    out.push((listMark ?? '') + s);
  }
  if (node.type === 'definition') {
    // Term first, then the meaning paragraphs (§2.4 "term: meaning").
    const meaning: string[] = [];
    for (const c of kids) textOf(c, depth + 1, meaning, null);
    out.push(`${node.attrs.term}: ${meaning.join('\n')}`.trim());
    return;
  }
  const isList = node.type === 'bulletList' || node.type === 'orderedList';
  let n = node.type === 'orderedList' ? (node.attrs?.start ?? 1) : 1;
  for (const c of kids) {
    if (c.type === 'text' || c.type === 'hardBreak') continue;
    if (isList && c.type === 'listItem') {
      const mark = `${'  '.repeat(depth)}${node.type === 'orderedList' ? `${n++}. ` : '• '}`;
      // The item's first paragraph carries the mark; nested lists indent further.
      let first = true;
      for (const part of c.content) {
        textOf(part, depth + 1, out, first ? mark : null);
        first = false;
      }
    } else {
      textOf(c, depth, out, listMark && !inline.length ? listMark : null);
      listMark = null;
    }
  }
}

/** Display view of a block for the diff. */
export function blockView(node: DocNode | null | undefined): BlockView {
  if (!node) return { label: 'Text', text: '' };
  const label = node.type === 'heading' ? `Heading ${node.attrs.level}` : (LABELS[node.type] ?? 'Block');
  const out: string[] = [];
  textOf(node, 0, out, null);
  return { label, text: out.join('\n') };
}

/** Display view of several nodes (a replace may turn one block into a few). */
export function nodesView(nodes: readonly DocNode[]): BlockView {
  if (nodes.length === 0) return { label: 'Removed', text: '' };
  const views = nodes.map(blockView);
  const label = views.length === 1 ? (views[0] as BlockView).label : `${views.length} blocks`;
  return { label, text: views.map((v) => v.text).join('\n') };
}
