/**
 * Typing shortcuts (plan F2) and the Enter fixes for stable block ids.
 *
 * Conservative IME rules (Gboard, iOS keyboards, Samsung): every handler
 * returns false while the view is composing or the key event is part of a
 * composition (isComposing / keyCode 229), so the platform keyboard stays in
 * charge and ProseMirror's own composition handling runs untouched.
 *
 * - Enter at the START of a non-empty line inserts an empty line ABOVE, so
 *   the text (and its block id, cards, anchors) stays put. Default
 *   ProseMirror would move the text to a new block with a new id.
 * - Enter in a Q&A question moves into the answer.
 * - "Term :: meaning" + Enter at the end of a line makes a definition box
 *   (the box takes the line's id, same rule as Beautify Lite).
 * - ==text== highlights with the pack's first highlighter. Markdown-style
 *   "# ", "- ", "1. ", "> " and "---" come from StarterKit's input rules.
 */
import { Extension, markInputRule } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';

const DEF_LINE = /^(.{1,60}?)\s*::\s*(\S.*)$/;
export const HIGHLIGHT_INPUT = /(?:^|\s)(==(?!\s+==)([^=]+)==(?!\s+==))$/;

export function isComposing(view: EditorView, event?: KeyboardEvent | null): boolean {
  return view.composing || !!event?.isComposing || event?.keyCode === 229;
}

export const StudyShortcuts = Extension.create({
  name: 'studyShortcuts',
  priority: 1000, // before list and paragraph Enter handling

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const view = editor.view;
        // TipTap shortcuts don't receive the key event; view.composing covers IME input.
        // (Keys sent during composition arrive as keyCode 229 "Unidentified" and never reach this keymap.)
        if (isComposing(view)) return false;
        const { state } = view;
        const sel = state.selection;
        if (!sel.empty) return false;
        const $from = sel.$from;
        const parent = $from.parent;

        // Q&A question: Enter moves into the answer
        if (parent.type.name === 'qaQuestion') {
          const qa = $from.node(-1);
          const qaStart = $from.before(-1);
          const answerPos = qaStart + 1 + (qa.child(0).nodeSize as number) + 2; // into answer's first paragraph
          const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.min(answerPos, state.doc.content.size))));
          view.dispatch(tr.scrollIntoView());
          return true;
        }

        if (!parent.isTextblock || parent.content.size === 0) return false;

        // "Term :: meaning" + Enter (cursor at the end; doc or column level)
        const container = $from.node(-1).type.name;
        if (parent.type.name === 'paragraph' && $from.parentOffset === parent.content.size && (container === 'doc' || container === 'column')) {
          const m = DEF_LINE.exec(parent.textContent);
          const term = m?.[1]?.trim();
          if (m && term && !/[.?!:;]/.test(term)) {
            const start = $from.before();
            const end = $from.after();
            const schema = state.schema;
            const restFrom = parent.textContent.length - (m[2] ?? '').length;
            const restSlice = parent.content.cut(restFrom);
            const def = schema.nodes.definition!.create({ term, blockId: parent.attrs.blockId }, [schema.nodes.paragraph!.create(null, restSlice)]);
            const after = schema.nodes.paragraph!.create();
            const tr = state.tr.replaceWith(start, end, [def, after]);
            tr.setSelection(TextSelection.create(tr.doc, start + def.nodeSize + 1));
            view.dispatch(tr.scrollIntoView());
            return true;
          }
        }

        // Enter at the start of a non-empty line: new empty line above
        if ($from.parentOffset !== 0) return false;
        const schema = state.schema;
        const inItem = $from.depth >= 2 && $from.node(-1).type.name === 'listItem' && $from.index(-1) === 0;
        let tr = state.tr;
        if (inItem) {
          const itemPos = $from.before(-1);
          tr = tr.insert(itemPos, schema.nodes.listItem!.create(null, schema.nodes.paragraph!.create()));
        } else {
          const containerNode = $from.node(-1);
          if (!containerNode.type.contentMatch.matchType(schema.nodes.paragraph!)) return false;
          tr = tr.insert($from.before(), schema.nodes.paragraph!.create());
        }
        tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(sel.from, 1)));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },

  addInputRules() {
    const type = this.editor.schema.marks.highlight;
    return type ? [markInputRule({ find: HIGHLIGHT_INPUT, type, getAttributes: () => ({ key: 'k0' }) })] : [];
  },
});
