/**
 * Editor WebView entry point (bundled by scripts/build-editor.mjs into a
 * single inline script whose SHA-256 is pinned in the page CSP).
 *
 * Trust model: messages from React Native are still validated here (defence
 * in depth), and nothing received is ever evaluated or inserted as HTML.
 */
import './zodConfig';

import type { Editor } from '@tiptap/core';

import { validateNoteDoc } from '../../src/core/document/parse';
import {
  decode,
  encode,
  MAX_BRIDGE_CHARS,
  toWebSchema,
  type ToNative,
  type ToWeb,
} from '../../src/modules/editor/protocol';
import { fontFaceCss, fontFaceDataSchema, packAttrs, packCss, validatePack } from '../../src/modules/stylepacks/web';
import { runCommand } from './commands';
import { createEditor } from './createEditor';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

const t0 = performance.now();
const CHANGE_DEBOUNCE_MS = 400;

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
let suppressChange = false;

const editor: Editor = createEditor({
  element: document.getElementById('editor') as HTMLElement,
  random,
  onUpdate: () => {
    if (suppressChange) return;
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => post({ v: 1, type: 'doc', reqId: null, reason: 'change', doc: editor.getJSON() }), CHANGE_DEBOUNCE_MS);
  },
  // Links open outside the app, never in this WebView (Apple age-rating rule).
  onLinkTap: (href) => post({ v: 1, type: 'openLink', href: href.slice(0, 2_000) }),
});

function handle(msg: ToWeb): void {
  switch (msg.type) {
    case 'load': {
      const s = performance.now();
      const r = validateNoteDoc(msg.doc);
      if (!r.ok) return post({ v: 1, type: 'error', code: r.error.code === 'too_large' ? 'too_large' : 'invalid_doc' });
      suppressChange = true;
      editor.commands.setContent(r.value, { emitUpdate: false });
      suppressChange = false;
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
      const faces = [];
      for (const f of msg.faces) {
        const parsed = fontFaceDataSchema.safeParse(f);
        if (!parsed.success) return post({ v: 1, type: 'error', code: 'invalid_fonts' });
        faces.push(parsed.data);
      }
      fontStyle.textContent = fontFaceCss(faces);
      post({ v: 1, type: 'metric', name: 'set_fonts_ms', ms: performance.now() - s });
      return;
    }
    case 'command':
      runCommand(editor, msg.name, msg.arg);
      return;
    case 'requestDoc':
      post({ v: 1, type: 'doc', reqId: msg.reqId, reason: 'request', doc: editor.getJSON() });
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
