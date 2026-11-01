/**
 * First-pass cleanup of pasted HTML (defence in depth: the CSP already
 * blocks scripts and remote loads, and ProseMirror's parser keeps only our
 * schema's node and mark types).
 *
 * DOMParser builds an inert document: scripts never run and images never
 * load. We then remove active elements and comments, unwrap any element
 * that is not on a small formatting allowlist (keeping its text), and drop
 * event handlers, inline styles and any URL that is not http(s) or mailto.
 * Table elements are kept (so pasted tables, including cut and paste inside
 * a note, stay tables) but lose every attribute except a well-formed
 * data-block-id on <table> (smart paste then keeps or renews it): the schema
 * has no merged cells, and normalize.ts pads ragged rows and turns oversized
 * tables into lines.
 */
import { BLOCK_ID } from '../../src/core/document/schema';

const BLOCKED =
  'script,style,iframe,frame,frameset,object,embed,applet,link,meta,base,form,input,button,textarea,select,svg,math,template,noscript,img,picture,video,audio,source,track,canvas';
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'a', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'hr', 'blockquote',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
]);
/** Kept without attributes (no colspan/rowspan/style/class/data-*); <table> may keep its block id. */
const BARE_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);
const DROP_ATTRS = new Set(['style', 'srcset', 'formaction', 'xlink:href', 'action', 'background', 'poster']);
const SAFE_URL = /^(https?:|mailto:)/i;

export const MAX_PASTE_CHARS = 1_000_000;

export function stripDangerousHtml(html: string): string {
  if (html.length > MAX_PASTE_CHARS) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(BLOCKED).forEach((el) => el.remove());

  const comments: Node[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));

  // Unwrap unknown elements deepest-first so their text survives.
  Array.from(doc.body.querySelectorAll('*'))
    .reverse()
    .forEach((el) => {
      if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) el.replaceWith(...Array.from(el.childNodes));
    });

  doc.body.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (BARE_TAGS.has(tag)) {
      for (const attr of Array.from(el.attributes)) {
        const keep = tag === 'table' && attr.name.toLowerCase() === 'data-block-id' && BLOCK_ID.test(attr.value);
        if (!keep) el.removeAttribute(attr.name);
      }
      return;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || DROP_ATTRS.has(name)) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src') && !SAFE_URL.test(attr.value.trim())) el.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}
