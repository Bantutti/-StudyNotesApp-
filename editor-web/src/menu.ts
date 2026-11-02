/**
 * Slash menu ("/" at the start of an empty line) and the + block picker.
 * Rendered INSIDE the page so each preview uses the current pack's CSS.
 * Built with createElement/textContent only (no innerHTML), so no note text
 * or pack value is ever parsed as HTML. Opening is driven by editor state
 * (not key events), so it works with any keyboard or IME.
 */
import type { Editor } from '@tiptap/core';

import { BLOCK_TEMPLATES, insertBlock, runCommand } from './commands';

interface Item {
  id: string;
  label: string;
  words: string;
  preview: () => HTMLElement;
  run: (editor: Editor) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const wrap = (cls: string, text: string) => {
  const d = el('div', cls);
  d.appendChild(el('p', undefined, text));
  return d;
};

export const MENU_ITEMS: Item[] = [
  { id: 'text', label: 'Text', words: 'text paragraph plain', preview: () => el('p', undefined, 'Plain text'), run: (e) => void runCommand(e, 'paragraph') },
  { id: 'h1', label: 'Title', words: 'heading 1 title h1', preview: () => { const h = el('h1', 'pk-h1'); h.appendChild(el('span', 't', 'Title')); return h; }, run: (e) => void runCommand(e, 'h1') },
  { id: 'h2', label: 'Heading', words: 'heading 2 h2 section', preview: () => el('h2', undefined, 'Heading'), run: (e) => void runCommand(e, 'h2') },
  { id: 'h3', label: 'Subheading', words: 'heading 3 h3 small', preview: () => el('h3', undefined, 'Subheading'), run: (e) => void runCommand(e, 'h3') },
  { id: 'bullets', label: 'Bullet list', words: 'list bullets ul', preview: () => { const u = el('ul'); u.appendChild(el('li', undefined, 'Point')); return u; }, run: (e) => void runCommand(e, 'bulletList') },
  { id: 'numbers', label: 'Numbered list', words: 'list numbers ol ordered steps', preview: () => { const o = el('ol'); o.appendChild(el('li', undefined, 'Step')); return o; }, run: (e) => void runCommand(e, 'orderedList') },
  { id: 'callout', label: 'Callout', words: 'callout tip note box', preview: () => wrap('pk-call', 'Remember this'), run: (e) => void runCommand(e, 'callout') },
  { id: 'definition', label: 'Definition', words: 'definition term card vocabulary', preview: () => { const d = wrap('pk-def', 'What it means'); d.setAttribute('data-term', 'Term'); return d; }, run: (e) => void runCommand(e, 'definition', 'Term') },
  { id: 'qa', label: 'Q&A', words: 'question answer qa quiz', preview: () => { const d = el('div', 'pk-qa'); d.appendChild(el('div', 'pk-q', 'Question?')); const a = el('div', 'pk-a'); a.appendChild(el('p', undefined, 'Answer')); d.appendChild(a); return d; }, run: (e) => void insertBlock(e, BLOCK_TEMPLATES.qa) },
  { id: 'quote', label: 'Quote', words: 'quote blockquote citation', preview: () => wrap('pk-quote', 'A line worth keeping'), run: (e) => void runCommand(e, 'blockquote') },
  { id: 'summary', label: 'Summary', words: 'summary recap box', preview: () => wrap('pk-sum', 'In short...'), run: (e) => void runCommand(e, 'summary') },
  { id: 'columns', label: 'Two columns', words: 'columns two side', preview: () => cols('even'), run: (e) => void insertBlock(e, BLOCK_TEMPLATES.columns) },
  { id: 'cornell', label: 'Cornell', words: 'cornell cue columns notes', preview: () => cols('cornell'), run: (e) => void insertBlock(e, BLOCK_TEMPLATES.cornell) },
  { id: 'table', label: 'Table', words: 'table grid rows columns', preview: () => { const t = el('table', 'pk-table'); const b = el('tbody'); const r = el('tr'); r.appendChild(el('th', undefined, 'A')); r.appendChild(el('th', undefined, 'B')); b.appendChild(r); t.appendChild(b); return t; }, run: (e) => void runCommand(e, 'table') },
  { id: 'divider', label: 'Divider', words: 'divider line hr rule', preview: () => el('hr'), run: (e) => void runCommand(e, 'hr') },
  { id: 'sketch', label: 'Sketch', words: 'sketch drawing draw diagram picture ink', preview: () => wrap('pk-sketch', ''), run: (e) => void runCommand(e, 'sketch') },
];

function cols(layout: 'even' | 'cornell') {
  const d = el('div', 'pk-cols');
  d.setAttribute('data-layout', layout);
  d.appendChild(wrap('pk-col', layout === 'cornell' ? 'Cue' : 'Left'));
  d.appendChild(wrap('pk-col', layout === 'cornell' ? 'Notes' : 'Right'));
  return d;
}

export function filterItems(query: string): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return MENU_ITEMS;
  return MENU_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.words.includes(q));
}

/** Detects "/query" as the whole text of the current empty-ish line, cursor at its end. */
export function slashQuery(editor: Editor): { from: number; to: number; query: string } | null {
  const { selection } = editor.state;
  if (!selection.empty || editor.view.composing) return null;
  const $f = selection.$from;
  const parent = $f.parent;
  if (parent.type.name !== 'paragraph' || $f.parentOffset !== parent.content.size) return null;
  const m = /^\/([\p{L}\p{N} &]{0,20})$/u.exec(parent.textContent);
  if (!m) return null;
  return { from: $f.start(), to: $f.end(), query: m[1] ?? '' };
}

export function createBlockMenu(editor: Editor, host: HTMLElement) {
  const box = el('div', 'sn-menu');
  box.setAttribute('role', 'listbox');
  box.setAttribute('aria-label', 'Insert a block');
  box.hidden = true;
  host.appendChild(box);
  let range: { from: number; to: number } | null = null;
  let picker = false;

  const close = () => {
    box.hidden = true;
    range = null;
    picker = false;
  };

  const choose = (item: Item) => {
    if (range) editor.chain().focus().deleteRange(range).run();
    close();
    item.run(editor);
  };

  const render = (items: Item[]) => {
    box.replaceChildren();
    if (!items.length) return close();
    for (const it of items) {
      const b = el('button', 'sn-item');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-label', it.label);
      const prev = el('div', 'sn-prev');
      prev.appendChild(it.preview());
      b.appendChild(prev);
      b.appendChild(el('span', 'sn-label', it.label));
      // mousedown/touchstart: keep editor focus (and the keyboard) while choosing
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        choose(it);
      });
      box.appendChild(b);
    }
    const { from } = editor.state.selection;
    const c = editor.view.coordsAtPos(from);
    box.style.top = `${Math.round(c.bottom + window.scrollY + 6)}px`;
    box.hidden = false;
  };

  const update = () => {
    if (picker) return;
    const s = slashQuery(editor);
    if (!s) return close();
    range = { from: s.from, to: s.to };
    render(filterItems(s.query));
  };

  editor.on('update', update);
  editor.on('selectionUpdate', update);
  editor.on('blur', () => setTimeout(() => !box.matches(':hover') && close(), 150));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());

  return {
    openPicker() {
      picker = true;
      range = null;
      render(MENU_ITEMS);
    },
    close,
    isOpen: () => !box.hidden,
  };
}
