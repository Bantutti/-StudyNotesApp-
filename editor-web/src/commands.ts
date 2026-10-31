import type { Editor } from '@tiptap/core';

import type { EditorCommand } from '../../src/modules/editor/protocol';

const KEYS = new Set(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']);

/** Maps a validated bridge command onto editor operations. */
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
    case 'hr':
      return c.setHorizontalRule().run();
    case 'highlight': {
      const key = arg && KEYS.has(arg) ? arg : 'k0';
      return c.setMark('highlight', { key }).run();
    }
    case 'unhighlight':
      return c.unsetMark('highlight').run();
    case 'undo':
      return c.undo().run();
    case 'redo':
      return c.redo().run();
  }
}
