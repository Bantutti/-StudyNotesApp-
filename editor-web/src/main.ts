/**
 * Editor WebView entry point (bundled by scripts/build-editor.mjs into a
 * single inline script whose SHA-256 is pinned in the page CSP).
 *
 * Trust model: messages from React Native are still validated here (defence
 * in depth), and nothing received is ever evaluated or inserted as HTML.
 * Every outgoing document is normalized and validated against the app's
 * schema first, so a change is never silently dropped by the native side.
 */
import './zodConfig';

import type { Editor } from '@tiptap/core';

import { validateNoteDoc } from '../../src/core/document/parse';
import {
  decode,
  encode,
  MAX_BRIDGE_CHARS,
  toWebSchema,
  type BlockKind,
  type ToNative,
  type ToWeb,
} from '../../src/modules/editor/protocol';
import { packAttrs, packCss, validatePack } from '../../src/modules/stylepacks/web';
import { runCommand } from './commands';
import { createEditor, loadDoc } from './createEditor';
import { createDiagnostics } from './diagnostics';
import { createFontState } from './fonts';
import { createBlockMenu } from './menu';
import { checkOutgoingDoc, requestDocReply } from './replies';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

const t0 = performance.now();
const CHANGE_DEBOUNCE_MS = 400;
const STATE_DEBOUNCE_MS = 150;

function post(msg: ToNative): void {
  const raw = encode(msg);
  if (raw.length > MAX_BRIDGE_CHARS) {
    window.ReactNativeWebView?.postMessage(encode({ v: 1, type: 'error', code: 'too_large' }));
    return;
  }
  window.ReactNativeWebView?.postMessage(raw);
}

const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

const root = document.getElementById('root') as HTMLElement;
const themeStyle = document.getElementById('theme') as HTMLStyleElement;
const fontStyle = document.getElementById('fonts') as HTMLStyleElement;

let changeTimer: ReturnType<typeof setTimeout> | null = null;
let stateTimer: ReturnType<typeof setTimeout> | null = null;
let suppressChange = false;
const fonts = createFontState();

/** The document to send: normalized, then validated with the app's schema. */
function currentDoc(): unknown | null {
  const c = checkOutgoingDoc(editor.getJSON());
  if (!c.ok) {
    post({ v: 1, type: 'error', code: c.code });
    return null;
  }
  return c.doc;
}

function blockKind(): BlockKind {
  const $f = editor.state.selection.$from;
  for (let d = $f.depth; d > 0; d--) {
    const n = $f.node(d);
    switch (n.type.name) {
      case 'heading':
        return (`heading${n.attrs.level as number}` as BlockKind);
      case 'bulletList':
      case 'orderedList':
      case 'callout':
      case 'definition':
      case 'blockquote':
      case 'summary':
      case 'qa':
      case 'columns':
      case 'table':
        return n.type.name as BlockKind;
    }
  }
  return $f.parent.type.name === 'paragraph' ? 'paragraph' : 'other';
}

function sendState(): void {
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    const marks = (['bold', 'italic', 'underline', 'strike', 'highlight', 'link'] as const).filter((m) => editor.isActive(m));
    post({
      v: 1,
      type: 'state',
      block: blockKind(),
      marks: [...marks],
      inTable: editor.isActive('table'),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    });
  }, STATE_DEBOUNCE_MS);
}

const editor: Editor = createEditor({
  element: document.getElementById('editor') as HTMLElement,
  random,
  onUpdate: () => {
    sendState();
    if (suppressChange) return;
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      if (editor.view.composing) return; // the next update after composition sends it
      const doc = currentDoc();
      if (doc) post({ v: 1, type: 'doc', reqId: null, reason: 'change', doc });
    }, CHANGE_DEBOUNCE_MS);
  },
  // Links open outside the app, never in this WebView (Apple age-rating rule).
  onLinkTap: (href) => post({ v: 1, type: 'openLink', href: href.slice(0, 2_000) }),
});
editor.on('selectionUpdate', sendState);

const menu = createBlockMenu(editor, root);
const diagnostics = createDiagnostics(editor, (events) => post({ v: 1, type: 'diag', events }), t0);

/** Top-level-first block ids touched by the selection (for editor actions). */
function selectionBlockIds(): string[] {
  const { from, to, empty } = editor.state.selection;
  if (empty) return [];
  const ids: string[] = [];
  editor.state.doc.nodesBetween(from, to, (node) => {
    const id = node.attrs?.blockId as unknown;
    if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
    return true;
  });
  return ids.slice(0, 5_000);
}

function scrollToBlock(id: string): void {
  let target = -1;
  editor.state.doc.descendants((n, pos) => {
    if (target >= 0) return false;
    if (n.attrs?.blockId === id) target = pos;
    return true;
  });
  if (target < 0) return;
  const dom = editor.view.nodeDOM(target);
  editor.chain().setTextSelection(Math.min(target + 1, editor.state.doc.content.size)).run();
  if (dom instanceof HTMLElement) {
    dom.scrollIntoView({ block: 'center' });
    dom.classList.add('sn-flash');
    setTimeout(() => dom.classList.remove('sn-flash'), 1600);
  }
}

function handle(msg: ToWeb): void {
  switch (msg.type) {
    case 'load': {
      const s = performance.now();
      const r = validateNoteDoc(msg.doc);
      if (!r.ok) return post({ v: 1, type: 'error', code: r.error.code === 'too_large' ? 'too_large' : 'invalid_doc' });
      suppressChange = true;
      loadDoc(editor, r.value);
      suppressChange = false;
      sendState();
      post({ v: 1, type: 'metric', name: 'load_ms', ms: performance.now() - s });
      return;
    }
    case 'setPack': {
      const s = performance.now();
      const report = validatePack(msg.pack);
      if (!report.ok || !report.pack) return post({ v: 1, type: 'error', code: 'invalid_pack' });
      themeStyle.textContent = packCss(report.pack);
      for (const [k, val] of Object.entries(packAttrs(report.pack))) root.setAttribute(k, val);
      document.body.style.backgroundColor = report.pack.paper.color;
      post({ v: 1, type: 'metric', name: 'set_pack_ms', ms: performance.now() - s });
      return;
    }
    case 'setFonts': {
      const s = performance.now();
      const css = fonts.apply(msg.faces, msg.append === true);
      if (css === null) return post({ v: 1, type: 'error', code: 'invalid_fonts' });
      fontStyle.textContent = css;
      post({ v: 1, type: 'metric', name: 'set_fonts_ms', ms: performance.now() - s });
      return;
    }
    case 'command':
      if (msg.name === 'blockPicker') menu.openPicker();
      else runCommand(editor, msg.name, msg.arg);
      return;
    case 'requestDoc':
      // Never an empty stand-in: an invalid live document is an error for this request.
      post(requestDocReply(editor.getJSON(), msg.reqId));
      return;
    case 'requestSelection':
      post({ v: 1, type: 'selection', reqId: msg.reqId, blockIds: selectionBlockIds() });
      return;
    case 'scrollToBlock':
      scrollToBlock(msg.blockId);
      return;
    case 'setDiagnostics':
      diagnostics.set(msg.on);
      return;
    case 'ping':
      post({ v: 1, type: 'pong', reqId: msg.reqId, sentAt: msg.sentAt });
      return;
  }
}

function onMessage(event: MessageEvent): void {
  try {
    const r = decode(event.data, toWebSchema);
    if (!r.ok) return post({ v: 1, type: 'error', code: r.reason === 'too_large' ? 'too_large' : 'invalid_message' });
    handle(r.msg);
  } catch {
    post({ v: 1, type: 'error', code: 'internal' });
  }
}

// react-native-webview delivers postMessage on document (Android) or window (iOS).
window.addEventListener('message', onMessage);
document.addEventListener('message', onMessage as unknown as EventListener);

post({ v: 1, type: 'metric', name: 'boot_ms', ms: performance.now() - t0 });
post({ v: 1, type: 'ready' });
