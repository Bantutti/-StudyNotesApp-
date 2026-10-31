/** Builds the TipTap editor with our schema and safety settings. */
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';

import { BlockId, Callout, Definition, makeIdFactory, PackHeading, PackHighlight, type RandomBytes } from './extensions';
import { stripDangerousHtml } from './sanitize';

export interface CreateEditorOptions {
  element: HTMLElement;
  random: RandomBytes;
  onUpdate?: () => void;
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
    },
    onUpdate: () => opts.onUpdate?.(),
  });
}
