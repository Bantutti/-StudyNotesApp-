/**
 * Builds the TipTap editor with our schema and safety settings.
 *
 * Input settings are deliberately conservative for Android keyboards
 * (Gboard, Samsung) and iOS, until real-phone typing diagnostics are in:
 *  - no custom key handling during IME composition (see shortcuts.ts),
 *  - the block-id pass waits for composition to end (blockIdPlugin.ts),
 *  - no node views or DOM rewrites while typing; menus are driven by state,
 *  - browser spellcheck/autocorrect stay ON (turning them off breaks Gboard
 *    composition on some versions), autocapitalize sentences.
 */
import { Editor, type JSONContent } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { StarterKit } from '@tiptap/starter-kit';

import { P1_BLOCKS } from './blocks';
import { BlockId, Callout, Definition, makeIdFactory, PackHeading, PackHighlight, type RandomBytes } from './extensions';
import { stripDangerousHtml } from './sanitize';
import { StudyShortcuts } from './shortcuts';

export interface CreateEditorOptions {
  element: HTMLElement;
  random: RandomBytes;
  onUpdate?: () => void;
  /**
   * A link was tapped. The page never navigates (the default action is
   * cancelled); the native side decides and opens it outside the app.
   */
  onLinkTap?: (href: string) => void;
}

/** Finds the link under a click, cancels its navigation and returns its raw href. */
export function linkFromEvent(event: Event, root: HTMLElement): string | null {
  const target = event.target as Element | null;
  const a = target && typeof target.closest === 'function' ? target.closest('a') : null;
  if (!a || !root.contains(a)) return null;
  event.preventDefault(); // never follow the link inside the WebView
  const href = a.getAttribute('href');
  return href && /^(https?:\/\/|mailto:)/i.test(href.trim()) ? href.trim() : null;
}

export const LINK_PROTOCOLS = ['http', 'https', 'mailto'];

export function createEditor(opts: CreateEditorOptions): Editor {
  return new Editor({
    element: opts.element,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false, // replaced by StudyBlockquote (paragraph+ only)
        listItem: false, // replaced by StudyListItem (simple blocks only)
        code: false,
        codeBlock: false,
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          protocols: LINK_PROTOCOLS,
          defaultProtocol: 'https',
          isAllowedUri: (url) => /^(https?:\/\/|mailto:)/i.test(url),
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
        },
      }),
      PackHeading,
      Callout,
      Definition,
      PackHighlight,
      ...P1_BLOCKS,
      StudyShortcuts,
      BlockId.configure({ newId: makeIdFactory(opts.random) }),
    ],
    editorProps: {
      attributes: { spellcheck: 'true', 'aria-label': 'Note editor', autocapitalize: 'sentences', autocorrect: 'on' },
      // Pasted HTML is untrusted: strip active content, then ProseMirror's
      // schema parser keeps only node/mark types our schema defines.
      transformPastedHTML: stripDangerousHtml,
      // Files and images are not supported in P1; ignore them on paste/drop.
      handlePaste: (_view, event) => (event.clipboardData?.files?.length ?? 0) > 0,
      handleDrop: (_view, event) => ((event as DragEvent).dataTransfer?.files?.length ?? 0) > 0,
      handleDOMEvents: {
        click: (view, event) => {
          const href = linkFromEvent(event, view.dom);
          if (href) opts.onLinkTap?.(href);
          return false; // let ProseMirror still place the cursor
        },
        auxclick: (view, event) => {
          linkFromEvent(event, view.dom); // middle-click: block only
          return false;
        },
      },
    },
    onUpdate: () => opts.onUpdate?.(),
  });
}

/**
 * Loads a document as a fresh start: the load itself can't be undone, and
 * the undo history is cleared (otherwise "Undo" right after opening a note
 * could rewind the load and blank the page). The cursor goes to the start.
 */
export function loadDoc(editor: Editor, doc: JSONContent): void {
  editor.commands.setContent(doc, { emitUpdate: false });
  const fresh = EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins });
  editor.view.updateState(fresh);
}
