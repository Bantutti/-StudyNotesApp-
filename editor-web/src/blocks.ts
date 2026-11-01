/**
 * P1 block nodes and content rules. Content expressions mirror
 * checkDocStructure() in src/core/document/schema.ts EXACTLY, so the editor
 * can never produce a document the app would reject:
 *   SIMPLE      = paragraph | heading | bulletList | orderedList | horizontalRule
 *   COLUMN_FLOW = every top-level block except columns
 * Rendered HTML uses the same pk-* classes as export (stylepacks BASE_CSS).
 */
import { mergeAttributes, Node } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { ListItem } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';

export const SIMPLE = '(paragraph | heading | bulletList | orderedList | horizontalRule)';
export const COLUMN_FLOW =
  '(paragraph | heading | bulletList | orderedList | callout | definition | horizontalRule | blockquote | summary | qa | table)';

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
  StudyTable, StudyTableRow, StudyTableHeader, StudyTableCell,
];
