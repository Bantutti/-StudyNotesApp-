/**
 * @jest-environment jsdom
 *
 * Block ids stay stable through every edit (exit criterion "block ids
 * stable across edits (tested)"), plus the P1 editor blocks and shortcuts.
 */
import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

import { listBlockIds, validateNoteDoc, type NoteDoc } from '../../src/core/document';
import { runCommand } from '../src/commands';
import { stripDangerousHtml } from '../src/sanitize';
import { createEditor, loadDoc } from '../src/createEditor';
import { filterItems, slashQuery } from '../src/menu';
import { normalizeDoc } from '../src/normalize';

// jsdom has no ClipboardEvent; ProseMirror's pasteHTML creates one.
if (typeof (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent === 'undefined') {
  (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent = class extends Event {
    clipboardData: DataTransfer | null = null;
  };
}

let counter = 0;
const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + counter++ * 13) & 0xff);
const A = 'b_AAAAAAAAAAAAAAAA';
const B = 'b_BBBBBBBBBBBBBBBB';
const C = 'b_CCCCCCCCCCCCCCCC';

const cell = (text: string): JSONContent => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function mount(content: JSONContent[]): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = createEditor({ element: el, random });
  loadDoc(ed, { type: 'doc', content });
  return ed;
}
const p = (text: string, blockId?: string): JSONContent => ({ type: 'paragraph', attrs: { blockId: blockId ?? null }, content: text ? [{ type: 'text', text }] : [] });
const valid = (ed: Editor): NoteDoc => {
  const r = validateNoteDoc(normalizeDoc(ed.getJSON()));
  if (!r.ok) throw new Error(`invalid doc: ${JSON.stringify(ed.getJSON())}`);
  return r.value;
};
const ids = (ed: Editor) => listBlockIds(valid(ed));
/** Top-level blocks, without the trailing empty line StarterKit's TrailingNode adds. */
const top = (ed: Editor) =>
  trimTrailing(valid(ed).content).map((n) => ({ type: n.type, id: ((n as JSONContent).attrs as { blockId?: string } | undefined)?.blockId, text: textOf(n as JSONContent) }));
function trimTrailing(nodes: NoteDoc['content']) {
  const out = [...nodes];
  const last = out[out.length - 1] as JSONContent | undefined;
  if (out.length > 1 && last?.type === 'paragraph' && !(last.content ?? []).length) out.pop();
  return out;
}
function textOf(n: JSONContent): string {
  return (n.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : textOf(c))).join('');
}
function typeText(ed: Editor, s: string) {
  for (const ch of s) {
    const { from, to } = ed.state.selection;
    const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)));
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
  }
}
/** A real keydown, as the phone keyboard sends it (keyboardShortcut() would drop selection-only changes). */
const enter = (ed: Editor) => ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
const unique = (list: string[]) => new Set(list).size === list.length;

afterEach(() => (document.body.innerHTML = ''));

describe('Enter', () => {
  it('at the start of a line inserts an empty line ABOVE; the text keeps its id', () => {
    const ed = mount([p('hello', A)]);
    ed.commands.setTextSelection(1);
    enter(ed);
    const t = top(ed);
    expect(t.map((x) => x.text)).toEqual(['', 'hello']);
    expect(t[1]?.id).toBe(A);
    expect(t[0]?.id).not.toBe(A);
    expect(unique(ids(ed))).toBe(true);
  });

  it('in the middle: the first half keeps the id, the second half gets a new one', () => {
    const ed = mount([p('hello world', A)]);
    ed.commands.setTextSelection(6);
    enter(ed);
    const t = top(ed);
    expect(t.map((x) => x.text)).toEqual(['hello', ' world']);
    expect(t[0]?.id).toBe(A);
    expect(t[1]?.id).not.toBe(A);
  });

  it('at the start of a list item: new item above, the item and its text keep their ids', () => {
    const ed = mount([{ type: 'bulletList', attrs: { blockId: C }, content: [{ type: 'listItem', attrs: { blockId: B }, content: [p('one', A)] }] }]);
    ed.commands.setTextSelection(3); // inside list > item > paragraph, offset 0
    enter(ed);
    const list = valid(ed).content[0] as { content: { attrs: { blockId: string }; content: { attrs: { blockId: string } }[] }[] };
    expect(list.content).toHaveLength(2);
    expect(list.content[1]?.attrs.blockId).toBe(B);
    expect(list.content[1]?.content[0]?.attrs.blockId).toBe(A);
    expect(unique(ids(ed))).toBe(true);
  });

  it('in a Q&A question moves into the answer instead of splitting', () => {
    const ed = mount([{ type: 'qa', content: [{ type: 'qaQuestion', content: [{ type: 'text', text: 'Why?' }] }, { type: 'qaAnswer', content: [p('')] }] }]);
    ed.commands.setTextSelection(4);
    enter(ed);
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(ed.state.selection.$from.node(-1).type.name).toBe('qaAnswer');
    expect(trimTrailing(valid(ed).content)).toHaveLength(1);
  });
});

describe('a split that skips the Enter shortcut (review L3: some keyboards split the block directly)', () => {
  it('split at the start, copying attributes (the DOM route): the text keeps its id, the empty line gets a new one', () => {
    const ed = mount([p('hello', A), p('next', B)]);
    ed.view.dispatch(ed.state.tr.split(1)); // the new block copies the attrs, so both carry A
    const t = top(ed);
    expect(t.map((x) => x.text)).toEqual(['', 'hello', 'next']);
    expect(t[1]?.id).toBe(A);
    expect(t[0]?.id).not.toBe(A);
    expect(t[2]?.id).toBe(B);
    expect(unique(ids(ed))).toBe(true);
  });

  it('split at the start, dropping the id (keepOnSplit false): the id still follows the text', () => {
    const ed = mount([p('hello', A)]);
    ed.view.dispatch(ed.state.tr.split(1, 1, [{ type: ed.schema.nodes.paragraph!, attrs: { blockId: null } }]));
    const t = top(ed);
    expect(t.map((x) => x.text)).toEqual(['', 'hello']);
    expect(t[1]?.id).toBe(A);
    expect(t[0]?.id).toMatch(/^b_/);
  });

  it('split at the start of a list item: the item and its paragraph keep their ids with the text', () => {
    const ed = mount([{ type: 'bulletList', attrs: { blockId: C }, content: [{ type: 'listItem', attrs: { blockId: B }, content: [p('one', A)] }] }]);
    ed.view.dispatch(ed.state.tr.split(3, 2));
    const list = valid(ed).content[0] as { content: { attrs: { blockId: string }; content: { attrs: { blockId: string } }[] }[] };
    expect(list.content).toHaveLength(2);
    expect(list.content[1]?.attrs.blockId).toBe(B);
    expect(list.content[1]?.content[0]?.attrs.blockId).toBe(A);
    expect(list.content[0]?.attrs.blockId).not.toBe(B);
    expect(unique(ids(ed))).toBe(true);
  });

  it('split in the middle: the first half keeps the id (same as the Enter shortcut)', () => {
    const ed = mount([p('hello world', A)]);
    ed.view.dispatch(ed.state.tr.split(6));
    const t = top(ed);
    expect(t.map((x) => x.text)).toEqual(['hello', ' world']);
    expect(t[0]?.id).toBe(A);
    expect(t[1]?.id).not.toBe(A);
  });

  it('clearing a line does not move its id to a different line that happens to match', () => {
    const ed = mount([p('same', A), p('same', B)]);
    ed.view.dispatch(ed.state.tr.delete(1, 5));
    const t = top(ed);
    expect(t.map((x) => x.id)).toEqual([A, B]);
  });
});

describe('turn into, wrap and undo keep ids', () => {
  it('paragraph -> heading -> paragraph keeps the id', () => {
    const ed = mount([p('Title', A)]);
    ed.commands.setTextSelection(2);
    runCommand(ed, 'h2');
    expect(top(ed)[0]).toMatchObject({ type: 'heading', id: A });
    runCommand(ed, 'paragraph');
    expect(top(ed)[0]).toMatchObject({ type: 'paragraph', id: A });
  });

  it('toggling a list or wrapping in a callout keeps the line id', () => {
    const ed = mount([p('point', A), p('tip', B)]);
    ed.commands.setTextSelection(2);
    runCommand(ed, 'bulletList');
    ed.commands.setTextSelection(ed.state.doc.content.size - 2);
    runCommand(ed, 'callout');
    expect(top(ed).map((x) => x.type)).toEqual(['bulletList', 'callout']);
    // Each id stays on its own line: "point" (now in a list item) keeps A, "tip" (now in a callout) keeps B.
    const [list, callout] = valid(ed).content as JSONContent[];
    const point = list!.content![0]!.content![0]!;
    const tip = callout!.content![0]!;
    expect(textOf(point)).toBe('point');
    expect(point.attrs?.blockId).toBe(A);
    expect(textOf(tip)).toBe('tip');
    expect(tip.attrs?.blockId).toBe(B);
    // the new wrappers got their own fresh ids
    expect(list!.attrs?.blockId).toMatch(/^b_/);
    expect([A, B]).not.toContain(list!.attrs?.blockId);
    expect([A, B]).not.toContain(callout!.attrs?.blockId);
    expect(unique(ids(ed))).toBe(true);
  });

  it('undo right after opening a note does nothing (the load is not undoable)', () => {
    const ed = mount([p('Title', A)]);
    runCommand(ed, 'undo');
    expect(top(ed)[0]).toMatchObject({ type: 'paragraph', id: A, text: 'Title' });
  });

  it('undo after turn-into restores the original block and id', () => {
    const ed = mount([p('Title', A)]);
    ed.commands.setTextSelection(2);
    runCommand(ed, 'h1');
    runCommand(ed, 'undo');
    expect(top(ed)[0]).toMatchObject({ type: 'paragraph', id: A });
  });
});

describe('paste (decision Q6: smart paste)', () => {
  it('a copy pasted ABOVE its original gets a fresh id; the original keeps it', () => {
    const ed = mount([p('', C), p('original', A)]);
    ed.commands.setTextSelection(1);
    ed.view.pasteHTML(`<p data-block-id="${A}">copy</p><p>more</p>`);
    const t = top(ed);
    const original = t.find((x) => x.text === 'original');
    const copy = t.find((x) => x.text === 'copy');
    expect(original?.id).toBe(A);
    expect(copy?.id).not.toBe(A);
    expect(unique(ids(ed))).toBe(true);
  });

  it('blocks pasted from another note get fresh ids even when unique', () => {
    const ed = mount([p('', C), p('mine', A)]);
    ed.commands.setTextSelection(1);
    ed.view.pasteHTML(`<p data-block-id="${B}">from another note</p><p>x</p>`);
    expect(ids(ed)).not.toContain(B);
  });

  it('cut and paste inside the note keeps the id (a move: cards and anchors follow)', () => {
    const ed = mount([p('first', A), p('second', B), p('', C)]);
    // select the whole second paragraph node and cut it
    const pos = ed.state.doc.child(0).nodeSize;
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)).deleteSelection().setMeta('uiEvent', 'cut'));
    expect(ids(ed)).not.toContain(B);
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    ed.view.pasteHTML(`<p data-block-id="${B}">second</p><p>tail</p>`);
    expect(top(ed).find((x) => x.text === 'second')?.id).toBe(B);
  });
});

describe('block menu operations', () => {
  it('duplicate: the original keeps its id, the copy gets a fresh one', () => {
    const ed = mount([p('one', A)]);
    ed.commands.setTextSelection(2);
    runCommand(ed, 'duplicateBlock');
    const t = top(ed);
    expect(t.map((x) => x.text)).toEqual(['one', 'one']);
    expect(t[0]?.id).toBe(A);
    expect(t[1]?.id).not.toBe(A);
  });

  it('move up / move down keep ids and swap order', () => {
    const ed = mount([p('one', A), p('two', B)]);
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize + 2);
    runCommand(ed, 'moveBlockUp');
    expect(top(ed).map((x) => x.id)).toEqual([B, A]);
    runCommand(ed, 'moveBlockDown');
    expect(top(ed).map((x) => x.id)).toEqual([A, B]);
  });

  it('delete block removes the unit and leaves a valid doc', () => {
    const ed = mount([p('only', A)]);
    ed.commands.setTextSelection(2);
    runCommand(ed, 'deleteBlock');
    expect(valid(ed).content).toHaveLength(1);
    expect(ids(ed)).not.toContain(A);
  });
});

describe('typing shortcuts', () => {
  it('"Term :: meaning" + Enter makes a definition box that keeps the line id', () => {
    const ed = mount([p('Osmosis :: water moves across a membrane', A)]);
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    enter(ed);
    const def = valid(ed).content[0] as { type: string; attrs: { term: string; blockId: string }; content: JSONContent[] };
    expect(def).toMatchObject({ type: 'definition', attrs: { term: 'Osmosis', blockId: A } });
    expect(textOf(def as unknown as JSONContent)).toBe('water moves across a membrane');
    expect(ed.state.selection.$from.parent.content.size).toBe(0); // cursor on the new empty line
  });

  it('==text== highlights with the first highlighter; "# " makes a heading', () => {
    const ed = mount([p('', A)]);
    ed.commands.setTextSelection(1);
    typeText(ed, 'see ==key idea==');
    expect(JSON.stringify(ed.getJSON())).toContain('"key":"k0"');
    const ed2 = mount([p('', B)]);
    ed2.commands.setTextSelection(1);
    typeText(ed2, '# Title');
    expect(top(ed2)[0]).toMatchObject({ type: 'heading', id: B });
  });
});

describe('IME composition safety', () => {
  it('waits while composing, then fixes ids once composition ends', async () => {
    const ed = mount([p('hello', A)]);
    let composing = true;
    Object.defineProperty(ed.view, 'composing', { get: () => composing, configurable: true });
    // a duplicate id appears while the keyboard is composing
    ed.view.dispatch(ed.state.tr.insert(ed.state.doc.content.size, ed.schema.nodes.paragraph!.create({ blockId: A })));
    const during = (ed.getJSON().content ?? []).map((n) => n.attrs?.blockId);
    expect(during.filter((x) => x === A)).toHaveLength(2); // untouched during composition
    composing = false;
    ed.view.dom.dispatchEvent(new Event('compositionend'));
    await new Promise((r) => setTimeout(r, 10));
    expect(unique(ids(ed))).toBe(true);
    expect(ids(ed)[0]).toBe(A);
  });
});

describe('P1 blocks in the editor', () => {
  it.each(['qa', 'columns', 'cornell', 'table', 'summary', 'blockquote', 'callout', 'hr'] as const)('%s inserts a valid block', (cmd) => {
    const ed = mount([p('text', A), p('', B)]);
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    runCommand(ed, cmd);
    const doc = valid(ed);
    expect(unique(listBlockIds(doc))).toBe(true);
    expect(listBlockIds(doc)).toContain(A);
  });

  it('table rows and columns can be added up to 12 columns', () => {
    const ed = mount([p('', A)]);
    ed.commands.setTextSelection(1);
    runCommand(ed, 'table');
    for (let i = 0; i < 15; i++) runCommand(ed, 'addColumnAfter');
    runCommand(ed, 'addRowAfter');
    const table = valid(ed).content.find((n) => n.type === 'table') as { content: { content: unknown[] }[] };
    expect(table.content[0]?.content).toHaveLength(12);
    expect(table.content).toHaveLength(4);
  });

  it('pasted HTML tables with merged or ragged cells are fixed (and stay tables), huge ones become lines', () => {
    const ed = mount([p('', A)]);
    ed.commands.setTextSelection(1);
    ed.view.pasteHTML('<table><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>');
    const fixed = valid(ed).content.find((n) => n.type === 'table') as { content: { content: { attrs?: { colspan?: number } }[] }[] } | undefined;
    expect(fixed).toBeDefined(); // review L2: the paste allowlist used to turn every table into lines
    expect(fixed!.content).toHaveLength(2);
    expect(fixed!.content.every((r) => r.content.length === 3)).toBe(true); // ragged row padded
    expect(JSON.stringify(fixed)).not.toMatch(/"colspan":2/);
    const cells = Array.from({ length: 13 }, (_, i) => `<td>c${i}</td>`).join('');
    const ed2 = mount([p('', B)]);
    ed2.commands.setTextSelection(1);
    ed2.view.pasteHTML(`<table><tr>${cells}</tr></table>`);
    const doc = valid(ed2);
    expect(doc.content.some((n) => n.type === 'table')).toBe(false);
    expect(JSON.stringify(doc)).toContain('c12');
  });

  it('a pasted table keeps its rows, header cells and text (no attributes carried over)', () => {
    const ed = mount([p('', A)]);
    ed.commands.setTextSelection(1);
    ed.view.pasteHTML('<table style="color:red" onclick="x()"><thead><tr><th class="h">Term</th><th>Meaning</th></tr></thead><tbody><tr><td data-x="1">osmosis</td><td><b>water</b> moves</td></tr></tbody></table>');
    const t = valid(ed).content.find((n) => n.type === 'table') as { content: { content: { type: string }[] }[] } | undefined;
    expect(t).toBeDefined();
    expect(t!.content[0]!.content.map((c) => c.type)).toEqual(['tableHeader', 'tableHeader']);
    expect(JSON.stringify(t)).toContain('osmosis');
    expect(JSON.stringify(t)).toContain('"bold"');
  });

  it('cut and paste of a table inside the same note keeps it a table', () => {
    const table = {
      type: 'table',
      attrs: { blockId: B },
      content: [
        { type: 'tableRow', content: [cell('x'), cell('y')] },
        { type: 'tableRow', content: [cell('1'), cell('2')] },
      ],
    };
    const ed = mount([p('above', A), table as JSONContent, p('below', C)]);
    const html = `<table data-block-id="${B}"><tbody><tr><td><p>x</p></td><td><p>y</p></td></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>`;
    const pos = ed.state.doc.child(0).nodeSize;
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)).deleteSelection().setMeta('uiEvent', 'cut'));
    expect(valid(ed).content.some((n) => n.type === 'table')).toBe(false);
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    ed.view.pasteHTML(html);
    const moved = valid(ed).content.filter((n) => n.type === 'table');
    expect(moved).toHaveLength(1);
    expect((moved[0] as { attrs?: { blockId?: string } }).attrs?.blockId).toBe(B); // a move keeps the id
    expect(JSON.stringify(moved[0])).toContain('"text":"2"');
    expect(stripDangerousHtml('<table data-block-id="javascript:x" border="1"><tr><td colspan="3">a</td></tr></table>')).not.toMatch(/data-block-id|border|colspan/);
  });

  it('pasting a callout into a list item cannot create an invalid nesting', () => {
    const ed = mount([{ type: 'bulletList', content: [{ type: 'listItem', content: [p('item', A)] }] }]);
    ed.commands.setTextSelection(4);
    ed.view.pasteHTML('<div class="pk-call"><p>tip</p></div><table><tr><td>x</td></tr></table>');
    expect(() => valid(ed)).not.toThrow();
  });
});

describe('slash menu', () => {
  it('opens for "/query" on an otherwise empty line and filters', () => {
    const ed = mount([p('/cal', A)]);
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    expect(slashQuery(ed)).toMatchObject({ query: 'cal' });
    expect(filterItems('cal').map((i) => i.id)).toContain('callout');
    expect(filterItems('').length).toBeGreaterThan(10);
    const ed2 = mount([p('a/b', B)]);
    ed2.commands.setTextSelection(ed2.state.doc.content.size - 1);
    expect(slashQuery(ed2)).toBeNull();
  });

  it('selection positions stay valid after inserting from the menu', () => {
    const ed = mount([p('', A)]);
    ed.commands.setTextSelection(1);
    filterItems('qa')[0]?.run(ed);
    expect(ed.state.selection).toBeInstanceOf(TextSelection);
    expect(() => valid(ed)).not.toThrow();
  });
});
