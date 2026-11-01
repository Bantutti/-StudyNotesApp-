/**
 * Maps validated bridge commands (and slash-menu picks) onto editor
 * operations. Block ids are kept by the BlockId plugin: turn-into restores
 * the id at the same position, moves keep ids, duplicates get fresh ones.
 */
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

import { DOC_LIMITS } from '../../src/core/document/schema';
import type { EditorCommand } from '../../src/modules/editor/protocol';

const KEYS = new Set(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']);
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

const para = (): JSONContent => ({ type: 'paragraph' });
export const BLOCK_TEMPLATES: Record<'qa' | 'columns' | 'cornell', JSONContent> = {
  qa: { type: 'qa', content: [{ type: 'qaQuestion' }, { type: 'qaAnswer', content: [para()] }] },
  columns: { type: 'columns', attrs: { layout: 'even' }, content: [{ type: 'column', content: [para()] }, { type: 'column', content: [para()] }] },
  cornell: { type: 'columns', attrs: { layout: 'cornell' }, content: [{ type: 'column', content: [para()] }, { type: 'column', content: [para()] }] },
};

/** The movable unit at the cursor: the ancestor whose parent is the doc or a column. */
export function unitAt($pos: ResolvedPos): { depth: number; node: PMNode; pos: number } | null {
  for (let d = $pos.depth; d >= 1; d--) {
    const parent = $pos.node(d - 1).type.name;
    if (parent === 'doc' || parent === 'column') return { depth: d, node: $pos.node(d), pos: $pos.before(d) };
  }
  return null;
}

/**
 * Inserts a block: replaces the current line if it is empty and at doc or
 * column level, else inserts after the current unit. Cursor goes inside.
 */
export function insertBlock(editor: Editor, block: JSONContent): boolean {
  const { state } = editor;
  const $from = state.selection.$from;
  const unit = unitAt($from);
  if (!unit) return false;
  const emptyLine = unit.node.type.name === 'paragraph' && unit.node.content.size === 0;
  const at = emptyLine ? { from: unit.pos, to: unit.pos + unit.node.nodeSize } : unit.pos + unit.node.nodeSize;
  const insertAt = typeof at === 'number' ? at : at.from;
  const ok = editor.chain().insertContentAt(at, block, { updateSelection: false }).run();
  if (ok) {
    // Put the cursor in the first text position inside the new block.
    const doc = editor.state.doc;
    let target = Math.min(insertAt + 1, doc.content.size);
    doc.nodesBetween(insertAt, Math.min(doc.content.size, insertAt + 400), (n, pos) => {
      if (target !== insertAt + 1) return false;
      if (n.isTextblock) {
        target = pos + 1;
        return false;
      }
      return true;
    });
    editor.chain().setTextSelection(target).focus().run();
  }
  return ok;
}

function moveUnit(editor: Editor, dir: -1 | 1): boolean {
  const { state, view } = editor;
  const unit = unitAt(state.selection.$from);
  if (!unit) return false;
  const $u = state.doc.resolve(unit.pos);
  const parent = $u.parent;
  const index = $u.index();
  const otherIndex = index + dir;
  if (otherIndex < 0 || otherIndex >= parent.childCount) return false;
  const other = parent.child(otherIndex);
  const offsetInUnit = state.selection.from - unit.pos;
  const tr = state.tr;
  if (dir === -1) {
    const otherPos = unit.pos - other.nodeSize;
    tr.delete(unit.pos, unit.pos + unit.node.nodeSize).insert(otherPos, unit.node);
    tr.setSelection(TextSelection.near(tr.doc.resolve(otherPos + offsetInUnit)));
  } else {
    const end = unit.pos + unit.node.nodeSize;
    tr.delete(unit.pos, end).insert(unit.pos + other.nodeSize, unit.node);
    tr.setSelection(TextSelection.near(tr.doc.resolve(unit.pos + other.nodeSize + offsetInUnit)));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

function duplicateUnit(editor: Editor): boolean {
  const { state, view } = editor;
  const unit = unitAt(state.selection.$from);
  if (!unit) return false;
  // Same ids for a moment; the BlockId plugin keeps them on the original and gives the copy fresh ones.
  view.dispatch(state.tr.insert(unit.pos + unit.node.nodeSize, unit.node.copy(unit.node.content)).scrollIntoView());
  return true;
}

function deleteUnit(editor: Editor): boolean {
  const { state, view } = editor;
  const unit = unitAt(state.selection.$from);
  if (!unit) return false;
  const tr = state.tr.delete(unit.pos, unit.pos + unit.node.nodeSize);
  if (tr.doc.childCount === 0) tr.insert(0, state.schema.nodes.paragraph!.create());
  view.dispatch(tr.scrollIntoView());
  return true;
}

function tableWidth(editor: Editor): number {
  const $f = editor.state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === 'tableRow') return $f.node(d).childCount;
  return 0;
}

export function runCommand(editor: Editor, name: EditorCommand, arg?: string): boolean {
  const c = editor.chain().focus();
  switch (name) {
    case 'bold':
      return c.toggleBold().run();
    case 'italic':
      return c.toggleItalic().run();
    case 'underline':
      return c.toggleUnderline().run();
    case 'strike':
      return c.toggleStrike().run();
    case 'highlight': {
      const key = arg && KEYS.has(arg) ? arg : 'k0';
      return c.setMark('highlight', { key }).run();
    }
    case 'unhighlight':
      return c.unsetMark('highlight').run();
    case 'link': {
      const href = (arg ?? '').trim();
      if (!SAFE_URL.test(href) || href.length > 2_000) return false;
      return c.extendMarkRange('link').setLink({ href }).run();
    }
    case 'unlink':
      return c.extendMarkRange('link').unsetLink().run();
    case 'h1':
      return c.toggleHeading({ level: 1 }).run();
    case 'h2':
      return c.toggleHeading({ level: 2 }).run();
    case 'h3':
      return c.toggleHeading({ level: 3 }).run();
    case 'paragraph':
      return c.setParagraph().run();
    case 'bulletList':
      return c.toggleBulletList().run();
    case 'orderedList':
      return c.toggleOrderedList().run();
    case 'callout':
      return c.wrapIn('callout').run();
    case 'definition': {
      const term = (arg ?? 'Term').slice(0, 200);
      return c.wrapIn('definition', { term }).run();
    }
    case 'blockquote':
      return c.toggleBlockquote().run();
    case 'summary':
      return c.wrapIn('summary').run();
    case 'hr':
      return c.setHorizontalRule().run();
    case 'qa':
      return insertBlock(editor, BLOCK_TEMPLATES.qa);
    case 'columns':
      return insertBlock(editor, BLOCK_TEMPLATES.columns);
    case 'cornell':
      return insertBlock(editor, BLOCK_TEMPLATES.cornell);
    case 'table':
      return c.insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
    case 'addRowAfter':
      return c.addRowAfter().run();
    case 'addColumnAfter':
      return tableWidth(editor) < DOC_LIMITS.maxTableCols ? c.addColumnAfter().run() : false;
    case 'deleteRow':
      return c.deleteRow().run();
    case 'deleteColumn':
      return c.deleteColumn().run();
    case 'deleteTable':
      return c.deleteTable().run();
    case 'duplicateBlock':
      return duplicateUnit(editor);
    case 'moveBlockUp':
      return moveUnit(editor, -1);
    case 'moveBlockDown':
      return moveUnit(editor, 1);
    case 'deleteBlock':
      return deleteUnit(editor);
    case 'undo':
      return c.undo().run();
    case 'redo':
      return c.redo().run();
    case 'blur':
      editor.commands.blur();
      return true;
    case 'blockPicker':
      return false; // handled by the menu in main.ts
  }
}
