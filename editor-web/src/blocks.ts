/**
 * P1 block nodes and content rules. Content expressions mirror
 * checkDocStructure() in src/core/document/schema.ts EXACTLY, so the editor
 * can never produce a document the app would reject:
 *   SIMPLE      = paragraph | heading | bulletList | orderedList | horizontalRule
 *   COLUMN_FLOW = every top-level block except columns (incl. the P4b sketch block)
 * Rendered HTML uses the same pk-* classes as export (stylepacks BASE_CSS).
 */
import { mergeAttributes, Node } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { ListItem } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';

export const SIMPLE = '(paragraph | heading | bulletList | orderedList | horizontalRule)';
export const COLUMN_FLOW =
  '(paragraph | heading | bulletList | orderedList | callout | definition | horizontalRule | blockquote | summary | qa | table | sketch)';

/** Sketch block height limits (mirror SKETCH_HEIGHT in src/core/document/schema.ts). */
const SKETCH_MIN = 120;
const SKETCH_MAX = 2400;
const clampHeight = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(SKETCH_MAX, Math.max(SKETCH_MIN, Math.round(n))) : 400;
};

/**
 * P4b sketch block (decision Q2): a framed drawing area in the note flow.
 * An atom (no text inside); its drawing lives in the note's ink layer,
 * anchored to this block's id. The height is the only attribute, clamped
 * on the way in (HTML paste) and out.
 */
export const Sketch = Node.create({
  name: 'sketch',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      height: {
        default: 400,
        parseHTML: (el: HTMLElement) => clampHeight(el.getAttribute('data-height')),
        renderHTML: (attrs: Record<string, unknown>) => {
          const h = clampHeight(attrs.height);
          return { 'data-height': String(h), style: `height:${h}px` };
        },
      },
    };
  },
  parseHTML: () => [{ tag: 'div.pk-sketch' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'pk-sketch', 'aria-label': 'Sketch' })],
});

/** List items: a paragraph first, then simple blocks only (no callouts or tables inside lists). */
export const StudyListItem = ListItem.extend({ content: `paragraph ${SIMPLE}*` });

export const StudyBlockquote = Blockquote.extend({
  content: 'paragraph+',
  renderHTML({ HTMLAttributes }) {
    return ['blockquote', mergeAttributes(HTMLAttributes, { class: 'pk-quote' }), 0];
  },
});

export const Summary = Node.create({
  name: 'summary',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  parseHTML: () => [{ tag: 'div.pk-sum' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'pk-sum' }), 0],
});

export const Qa = Node.create({
  name: 'qa',
  group: 'block',
  content: 'qaQuestion qaAnswer',
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: 'div.pk-qa' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'pk-qa' }), 0],
});

export const QaQuestion = Node.create({
  name: 'qaQuestion',
  content: 'inline*',
  defining: true,
  parseHTML: () => [{ tag: 'div.pk-q' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'pk-q' }), 0],
});

export const QaAnswer = Node.create({
  name: 'qaAnswer',
  content: 'paragraph+',
  defining: true,
  parseHTML: () => [{ tag: 'div.pk-a' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'pk-a' }), 0],
});

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column column',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      layout: {
        default: 'even',
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-layout') === 'cornell' ? 'cornell' : 'even'),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-layout': attrs.layout === 'cornell' ? 'cornell' : 'even' }),
      },
    };
  },
  parseHTML: () => [{ tag: 'div.pk-cols' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'pk-cols' }), 0],
});

export const Column = Node.create({
  name: 'column',
  content: `${COLUMN_FLOW}+`,
  isolating: true,
  parseHTML: () => [{ tag: 'div.pk-col' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'pk-col' }), 0],
});

/** Merged cells are not supported (schema v2): spans are always 1, from HTML too. */
const noSpans = {
  colspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
  rowspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
};

export const StudyTableCell = TableCell.extend({
  content: 'paragraph+',
  addAttributes() {
    return { ...this.parent?.(), ...noSpans };
  },
});

export const StudyTableHeader = TableHeader.extend({
  content: 'paragraph+',
  addAttributes() {
    return { ...this.parent?.(), ...noSpans };
  },
});

export const StudyTableRow = TableRow.extend({ content: '(tableCell | tableHeader)+' });

export const StudyTable = Table.extend({
  renderHTML({ HTMLAttributes }) {
    return ['table', mergeAttributes(HTMLAttributes, { class: 'pk-table' }), ['tbody', 0]];
  },
}).configure({ resizable: false, allowTableNodeSelection: false });

export const P1_BLOCKS = [
  StudyListItem, StudyBlockquote, Summary, Qa, QaQuestion, QaAnswer, Columns, Column,
  StudyTable, StudyTableRow, StudyTableHeader, StudyTableCell, Sketch,
];
