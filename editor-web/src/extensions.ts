/**
 * TipTap extensions for the study-notes document model.
 * - BlockId (blockIdPlugin.ts): every block keeps a stable id through edits,
 *   splits, turn-into, paste and moves. Cards, audio anchors and versions point to it.
 * - Heading: levels 1-3; h1 wraps content in span.t for pack header styles.
 * - Callout / Definition: study blocks styled by the pack.
 * - PackHighlight: highlight stores a pack KEY (k0..k5), never a colour,
 *   so switching packs recolours highlights automatically.
 */
import { Mark, mergeAttributes, Node } from '@tiptap/core';
import { Heading } from '@tiptap/extension-heading';

import { HIGHLIGHT_KEYS } from '../../src/core/document/schema';

export { BlockId, makeIdFactory, type RandomBytes } from './blockIdPlugin';

export const PackHeading = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level as number;
    if (level === 1) return ['h1', mergeAttributes(HTMLAttributes, { class: 'pk-h1' }), ['span', { class: 't' }, 0]];
    return [`h${level}`, HTMLAttributes, 0];
  },
}).configure({ levels: [1, 2, 3] });

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  parseHTML: () => [{ tag: 'div.pk-call' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'pk-call' }), 0],
});

export const Definition = Node.create({
  name: 'definition',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return {
      term: {
        default: '',
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-term') ?? '').slice(0, 200),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-term': String(attrs.term ?? '').slice(0, 200) }),
      },
    };
  },
  parseHTML: () => [{ tag: 'div.pk-def' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'pk-def' }), 0],
});

const KEYS = new Set<string>(HIGHLIGHT_KEYS);

export const PackHighlight = Mark.create({
  name: 'highlight',
  addAttributes() {
    return {
      key: {
        default: 'k0',
        parseHTML: (el: HTMLElement) => {
          const k = el.getAttribute('data-k');
          return k && KEYS.has(k) ? k : 'k0';
        },
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-k': KEYS.has(String(attrs.key)) ? attrs.key : 'k0' }),
      },
    };
  },
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', HTMLAttributes, 0],
});
