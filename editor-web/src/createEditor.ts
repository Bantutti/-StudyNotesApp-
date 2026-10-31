/** Builds the TipTap editor with our schema and safety settings. */
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';

import { BlockId, Callout, Definition, makeIdFactory, PackHeading, PackHighlight, type RandomBytes } from './extensions';
import { stripDangerousHtml } from './sanitize';

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
        blockquote: false,
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
      BlockId.configure({ newId: makeIdFactory(opts.random) }),
    ],
    editorProps: {
      attributes: { spellcheck: 'true', 'aria-label': 'Note editor', autocapitalize: 'sentences' },
      // Pasted HTML is untrusted: strip active content, then ProseMirror's
      // schema parser keeps only node/mark types our schema defines.
      transformPastedHTML: stripDangerousHtml,
      // Files and images are not supported in P0; ignore them on paste/drop.
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
