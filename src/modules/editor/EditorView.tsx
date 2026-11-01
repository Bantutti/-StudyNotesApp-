/**
 * Native host for the TipTap editor WebView.
 * - Loads the generated, CSP-pinned HTML (no network, no navigation).
 * - Validates every inbound message (size -> JSON -> schema -> doc schema).
 * - Exposes a small imperative API to screens.
 * - Recovers from a WebView crash: iOS reloads the page, Android remounts the
 *   WebView; pending requests fail, and on every 'ready' the current pack,
 *   fonts and the newest document (getDoc) are sent again.
 * - A requestDoc the page cannot answer with a valid document is rejected
 *   (never answered with a stand-in document).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { AppError, validateNoteDoc, type Logger, type NoteDoc } from '@/core';
import type { FontFaceData, StylePack } from '@/modules/stylepacks';

import { EDITOR_HTML } from './generated/editorHtml';
import {
  chunkInkItems,
  decode,
  encode,
  INK_MAX_ITEMS,
  toNativeSchema,
  type DiagEvent,
  type EditorCommand,
  type InkItem,
  type ToNative,
  type ToWeb,
} from './protocol';
import { allowNavigation, HARDENED_WEBVIEW_PROPS } from './webviewPolicy';

export interface EditorHandle {
  load(doc: NoteDoc): void;
  setPack(pack: StylePack): void;
  setFonts(faces: readonly FontFaceData[]): void;
  command(name: EditorCommand, arg?: string): void;
  requestDoc(): Promise<NoteDoc>;
  /** Block ids touched by the current selection (empty when nothing is selected). */
  requestSelection(): Promise<string[]>;
  scrollToBlock(blockId: string): void;
  setDiagnostics(on: boolean): void;
  ping(): Promise<number>;
  // ---- ink (P4b) -------------------------------------------------------
  /** Draws strokes (path data in block units). Sent in chunks under the bridge limits. */
  inkAdd(items: readonly InkItem[]): void;
  inkRemove(ids: readonly string[]): void;
  inkClear(): void;
  /** Draw mode: the page pushes onInkLayout after every layout change. */
  setInkFeed(on: boolean): void;
  /** Block boxes and the page origin right now. */
  requestInkLayout(): Promise<InkLayoutMessage>;
}

/** Ink layout from the page (block boxes in page px, page origin in viewport px). */
export type InkLayoutMessage = Extract<ToNative, { type: 'inkLayout' }>;

export type EditorState = Extract<ToNative, { type: 'state' }>;

export interface EditorEvents {
  onReady?: () => void;
  onChange?: (doc: NoteDoc) => void;
  onMetric?: (name: Extract<ToNative, { type: 'metric' }>['name'], ms: number) => void;
  onBridgeError?: (code: string) => void;
  /** A link was tapped in the note. Wire to a LinkOpener (opens outside the app). */
  onOpenLink?: (href: string) => void;
  /** Toolbar state at the cursor (block kind, active marks, undo/redo). */
  onState?: (state: EditorState) => void;
  /** Typing diagnostics batches (only when setDiagnostics(true)). Metadata only. */
  onDiag?: (events: DiagEvent[]) => void;
  /** P4b: layout pushed by the ink feed (setInkFeed(true)). */
  onInkLayout?: (layout: InkLayoutMessage) => void;
  /** P4b: these strokes are now drawn by the page. */
  onInkAck?: (ids: string[]) => void;
}

interface Props extends EditorEvents {
  logger: Logger;
  /** Sent on every 'ready' (first start and after a WebView restart) and whenever it changes. */
  pack?: StylePack | null;
  /** Sent on every 'ready' and whenever they change. */
  faces?: readonly FontFaceData[] | null;
  /** The document to show on every 'ready': the newest one the screen holds, never a stale copy. */
  getDoc?: () => NoteDoc | null;
}

// react-native-webview types the class as WebView<P = undefined>, so its props
// become WebViewProps & undefined (= never) under strict TS. Instantiate with object.
const HostWebView = WebView<object>;
type HostWebViewRef = InstanceType<typeof HostWebView>;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export const EditorView = forwardRef<EditorHandle, Props>(function EditorView(props, ref) {
  const web = useRef<HostWebViewRef>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  const isReady = useRef(false);
  const [generation, setGeneration] = useState(0);
  const log = props.logger.child('editor');
  const { pack, faces } = props;

  const send = useCallback((msg: ToWeb) => {
    web.current?.postMessage(encode(msg));
  }, []);

  const request = useCallback(
    <T,>(build: (reqId: number) => ToWeb, timeoutMs = 5_000): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const reqId = nextId.current++;
        const timer = setTimeout(() => {
          pending.current.delete(reqId);
          reject(new Error('editor_timeout'));
        }, timeoutMs);
        pending.current.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer });
        send(build(reqId));
      }),
    [send],
  );

  useEffect(() => {
    if (isReady.current && pack) send({ v: 1, type: 'setPack', pack });
  }, [pack, send]);
  useEffect(() => {
    if (isReady.current && faces) send({ v: 1, type: 'setFonts', faces: [...faces] });
  }, [faces, send]);

  /** The page is gone (crash): fail what is waiting; the next 'ready' restores everything. */
  const lost = () => {
    isReady.current = false;
    for (const [id, p] of pending.current) {
      clearTimeout(p.timer);
      p.reject(new AppError('timeout', 'The editor restarted. Try again.'));
      pending.current.delete(id);
    }
  };

  const settle = (reqId: number, value: unknown, error?: Error) => {
    const p = pending.current.get(reqId);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(reqId);
    if (error) p.reject(error);
    else p.resolve(value);
  };

  const onMessage = (e: WebViewMessageEvent) => {
    const r = decode(e.nativeEvent.data, toNativeSchema);
    if (!r.ok) {
      log.warn('bridge_rejected', { reason: r.reason });
      return;
    }
    const msg = r.msg;
    switch (msg.type) {
      case 'ready': {
        isReady.current = true;
        if (pack) send({ v: 1, type: 'setPack', pack });
        if (faces) send({ v: 1, type: 'setFonts', faces: [...faces] });
        const doc = props.getDoc?.();
        if (doc) send({ v: 1, type: 'load', doc });
        props.onReady?.();
        return;
      }
      case 'metric':
        props.onMetric?.(msg.name, msg.ms);
        return;
      case 'error':
        log.warn('editor_error', { code: msg.code });
        if (msg.reqId != null) {
          settle(
            msg.reqId,
            null,
            msg.code === 'too_large'
              ? new AppError('too_large', 'This note is too long to save.')
              : new AppError('validation_failed', 'The editor could not check this note.'),
          );
        }
        props.onBridgeError?.(msg.code);
        return;
      case 'openLink':
        props.onOpenLink?.(msg.href);
        return;
      case 'state':
        props.onState?.(msg);
        return;
      case 'diag':
        props.onDiag?.(msg.events);
        return;
      case 'selection':
        settle(msg.reqId, msg.blockIds);
        return;
      case 'inkLayout':
        if (msg.reqId !== null) settle(msg.reqId, msg);
        else props.onInkLayout?.(msg);
        return;
      case 'inkAck':
        props.onInkAck?.(msg.ids);
        return;
      case 'pong':
        settle(msg.reqId, Date.now() - msg.sentAt);
        return;
      case 'doc': {
        const doc = validateNoteDoc(msg.doc);
        if (!doc.ok) {
          log.warn('doc_rejected', { code: doc.error.code });
          if (msg.reqId !== null) settle(msg.reqId, null, doc.error);
          return;
        }
        if (msg.reqId !== null) settle(msg.reqId, doc.value);
        else props.onChange?.(doc.value);
        return;
      }
    }
  };

  useImperativeHandle(ref, () => ({
    load: (doc) => send({ v: 1, type: 'load', doc }),
    setPack: (pack) => send({ v: 1, type: 'setPack', pack }),
    setFonts: (faces) => send({ v: 1, type: 'setFonts', faces: [...faces] }),
    command: (name, arg) => send({ v: 1, type: 'command', name, arg }),
    requestDoc: () => request<NoteDoc>((reqId) => ({ v: 1, type: 'requestDoc', reqId })),
    requestSelection: () => request<string[]>((reqId) => ({ v: 1, type: 'requestSelection', reqId })),
    scrollToBlock: (blockId) => send({ v: 1, type: 'scrollToBlock', blockId }),
    setDiagnostics: (on) => send({ v: 1, type: 'setDiagnostics', on }),
    ping: () => request<number>((reqId) => ({ v: 1, type: 'ping', reqId, sentAt: Date.now() })),
    inkAdd: (items) => {
      for (const chunk of chunkInkItems(items)) send({ v: 1, type: 'inkAdd', items: chunk });
    },
    inkRemove: (ids) => {
      for (let i = 0; i < ids.length; i += INK_MAX_ITEMS) send({ v: 1, type: 'inkRemove', ids: ids.slice(i, i + INK_MAX_ITEMS) });
    },
    inkClear: () => send({ v: 1, type: 'inkClear' }),
    setInkFeed: (on) => send({ v: 1, type: 'setInkFeed', on }),
    requestInkLayout: () => request<InkLayoutMessage>((reqId) => ({ v: 1, type: 'requestInkLayout', reqId })),
  }));

  return (
    <HostWebView
      key={generation}
      ref={web}
      style={styles.web}
      source={{ html: EDITOR_HTML }}
      {...HARDENED_WEBVIEW_PROPS}
      webviewDebuggingEnabled={__DEV__}
      hideKeyboardAccessoryView
      automaticallyAdjustContentInsets={false}
      onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest) => allowNavigation(req.url)}
      onOpenWindow={() => undefined}
      onMessage={onMessage}
      onContentProcessDidTerminate={() => {
        log.warn('content_process_terminated');
        lost();
        web.current?.reload();
      }}
      onRenderProcessGone={() => {
        // Android: the WebView instance is dead and must be replaced, not reloaded.
        log.warn('render_process_gone');
        lost();
        setGeneration((g) => g + 1);
        return true;
      }}
    />
  );
});

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: 'transparent' } });
