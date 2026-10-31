/**
 * TipTap extensions for the study-notes document model.
 * - BlockId: every block gets a stable random id (kept on edits, new on split,
 *   de-duplicated on paste). Cards, audio anchors and versions point to it.
 * - Heading: levels 1-3; h1 wraps content in span.t for pack header styles.
 * - Callout / Definition: study blocks styled by the pack.
 * - PackHighlight: highlight stores a pack KEY (k0..k5), never a colour,
 *   so switching packs recolours highlights automatically.
 */
import { Extension, Mark, mergeAttributes, Node } from '@tiptap/core';
import { Heading } from '@tiptap/extension-heading';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import { BLOCK_ID, BLOCK_TYPES, HIGHLIGHT_KEYS } from '../../src/core/document/schema';

export type RandomBytes = (n: number) => Uint8Array;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz';

export function makeIdFactory(random: RandomBytes) {
  return () => {
    const bytes = random(16);
    let s = 'b_';
    for (let i = 0; i < 16; i++) s += ALPHABET[(bytes[i] as number) % ALPHABET.length];
    return s;
  };
}

export const BlockId = Extension.create<{ newId: () => string }>({
  name: 'blockId',
  addOptions() {
    return { newId: () => 'b_unset' };
  },
  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_TYPES],
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) => {
              const v = el.getAttribute('data-block-id');
              return v && BLOCK_ID.test(v) ? v : null;
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              typeof attrs.blockId === 'string' ? { 'data-block-id': attrs.blockId } : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const newId = this.options.newId;
    const types = new Set<string>(BLOCK_TYPES);
    return [
      new Plugin({
        key: new PluginKey('blockId'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged) && trs.length > 0) return null;
          const tr = state.tr;
          const seen = new Set<string>();
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (!types.has(node.type.name)) return;
            const id = node.attrs.blockId as unknown;
            if (typeof id === 'string' && BLOCK_ID.test(id) && !seen.has(id)) {
              seen.add(id);
              return;
            }
            const fresh = newId();
            seen.add(fresh);
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: fresh });
            changed = true;
          });
          return changed ? tr.setMeta('addToHistory', false) : null;
        },
      }),
    ];
  },
});

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
