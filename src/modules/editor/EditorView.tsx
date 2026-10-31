/**
 * Native host for the TipTap editor WebView.
 * - Loads the generated, CSP-pinned HTML (no network, no navigation).
 * - Validates every inbound message (size -> JSON -> schema -> doc schema).
 * - Exposes a small imperative API to screens.
 */
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { validateNoteDoc, type Logger, type NoteDoc } from '@/core';
import type { FontFaceData, StylePack } from '@/modules/stylepacks';

import { EDITOR_HTML } from './generated/editorHtml';
import { decode, encode, toNativeSchema, type EditorCommand, type ToNative, type ToWeb } from './protocol';
import { allowNavigation, HARDENED_WEBVIEW_PROPS } from './webviewPolicy';

export interface EditorHandle {
  load(doc: NoteDoc): void;
  setPack(pack: StylePack): void;
  setFonts(faces: readonly FontFaceData[]): void;
  command(name: EditorCommand, arg?: string): void;
  requestDoc(): Promise<NoteDoc>;
  ping(): Promise<number>;
}

export interface EditorEvents {
  onReady?: () => void;
  onChange?: (doc: NoteDoc) => void;
  onMetric?: (name: Extract<ToNative, { type: 'metric' }>['name'], ms: number) => void;
  onBridgeError?: (code: string) => void;
}

interface Props extends EditorEvents {
  logger: Logger;
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
  const log = props.logger.child('editor');

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
      case 'ready':
        props.onReady?.();
        return;
      case 'metric':
        props.onMetric?.(msg.name, msg.ms);
        return;
      case 'error':
        log.warn('editor_error', { code: msg.code });
        props.onBridgeError?.(msg.code);
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
    ping: () => request<number>((reqId) => ({ v: 1, type: 'ping', reqId, sentAt: Date.now() })),
  }));

  return (
    <HostWebView
      ref={web}
      style={styles.web}
      source={{ html: EDITOR_HTML }}
      {...HARDENED_WEBVIEW_PROPS}
      webviewDebuggingEnabled={__DEV__}
      onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest) => allowNavigation(req.url)}
      onOpenWindow={() => undefined}
      onMessage={onMessage}
      onContentProcessDidTerminate={() => web.current?.reload()}
      onRenderProcessGone={() => {
        log.warn('render_process_gone');
        return true;
      }}
    />
  );
});

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: 'transparent' } });
