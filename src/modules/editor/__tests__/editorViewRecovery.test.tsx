/**
 * EditorView (native side of the editor bridge), with the WebView mocked:
 * - M1: a requestDoc answered with an error carrying its reqId is rejected
 *   (never resolved with a stand-in document).
 * - M3: on every 'ready' the pack, fonts and newest document are sent again;
 *   Android render-process loss remounts the WebView; iOS content-process
 *   loss reloads it; pending requests fail instead of hanging.
 */
import { act, createRef } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import { createLogger, memorySink, type NoteDoc } from '@/core';
import { createPackRegistry, DEFAULT_PACK_ID } from '@/modules/stylepacks';

import { webviewMock } from '../../../../test/mocks/react-native-webview';
import { EditorView, type EditorHandle } from '../EditorView';
import { decode, encode, MAX_BRIDGE_CHARS, toWebSchema, type ToNative } from '../protocol';

const pack = createPackRegistry().getOrDefault(DEFAULT_PACK_ID);
const docA: NoteDoc = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b_firstversion01' }, content: [{ type: 'text', text: 'opened' }] }] };
const docB: NoteDoc = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b_firstversion01' }, content: [{ type: 'text', text: 'newer edits' }] }] };

function webview(root: Root): TestInstance {
  const w = root.container.queryAll((n) => n.props.testID === 'webview');
  expect(w).toHaveLength(1);
  return w[0]!;
}
async function fromWeb(root: Root, msg: ToNative) {
  await act(async () => webview(root).props.onMessage({ nativeEvent: { data: encode(msg) } }));
}
const sent = () => webviewMock.posted.map((s) => JSON.parse(s) as { type: string; reqId?: number; doc?: NoteDoc; pack?: { id: string } });

async function mount(getDoc: () => NoteDoc | null) {
  webviewMock.reset();
  const ref = createRef<EditorHandle>();
  const errors: string[] = [];
  let readies = 0;
  const root = createRoot();
  await act(async () => {
    root.render(
      <EditorView
        ref={ref}
        logger={createLogger({ sink: memorySink() })}
        pack={pack}
        faces={[]}
        getDoc={getDoc}
        onReady={() => (readies += 1)}
        onBridgeError={(c) => errors.push(c)}
      />,
    );
  });
  return { root, ref, errors, readies: () => readies };
}

describe('EditorView: requestDoc never resolves with a stand-in (review M1)', () => {
  it('an error answering the request (same reqId) rejects requestDoc', async () => {
    const { root, ref, errors } = await mount(() => docA);
    const p = ref.current!.requestDoc();
    const req = sent().find((m) => m.type === 'requestDoc')!;
    await fromWeb(root, { v: 1, type: 'error', code: 'invalid_doc', reqId: req.reqId! });
    await expect(p).rejects.toMatchObject({ code: 'validation_failed' });
    expect(errors).toEqual(['invalid_doc']); // the screen still shows its banner
    await act(async () => root.unmount());
  });

  it('a too_large error for the request rejects with too_large; a valid answer resolves', async () => {
    const { root, ref } = await mount(() => docA);
    const p1 = ref.current!.requestDoc();
    await fromWeb(root, { v: 1, type: 'error', code: 'too_large', reqId: sent().at(-1)!.reqId! });
    await expect(p1).rejects.toMatchObject({ code: 'too_large' });
    const p2 = ref.current!.requestDoc();
    await fromWeb(root, { v: 1, type: 'doc', reqId: sent().at(-1)!.reqId!, reason: 'request', doc: docB });
    await expect(p2).resolves.toEqual(docB);
    await act(async () => root.unmount());
  });
});

describe('EditorView: WebView crash recovery (review M3)', () => {
  it('every ready re-sends pack and fonts and loads the NEWEST document (not the one from opening)', async () => {
    let newest: NoteDoc = docA;
    const { root, readies } = await mount(() => newest);
    await fromWeb(root, { v: 1, type: 'ready' });
    expect(sent().map((m) => m.type)).toEqual(['setPack', 'setFonts', 'load']);
    expect(sent()[2]!.doc).toEqual(docA);

    newest = docB; // edits made after opening
    webviewMock.posted = [];
    await fromWeb(root, { v: 1, type: 'ready' }); // the page restarted
    expect(sent().map((m) => m.type)).toEqual(['setPack', 'setFonts', 'load']);
    expect(sent()[0]!.pack!.id).toBe(pack.id);
    expect(sent()[2]!.doc).toEqual(docB);
    expect(readies()).toBe(2);
    await act(async () => root.unmount());
  });

  it('Android render-process loss remounts the WebView and fails pending requests', async () => {
    const { root, ref } = await mount(() => docA);
    await fromWeb(root, { v: 1, type: 'ready' });
    expect(webviewMock.mounts).toBe(1);
    const p = ref.current!.requestDoc();
    let returned: unknown;
    await act(async () => {
      returned = webview(root).props.onRenderProcessGone();
    });
    expect(returned).toBe(true); // handled: the app is not killed
    expect(webviewMock.mounts).toBe(2); // a fresh WebView instance
    await expect(p).rejects.toMatchObject({ code: 'timeout' });
    // The new page says ready: everything is restored.
    webviewMock.posted = [];
    await fromWeb(root, { v: 1, type: 'ready' });
    expect(sent().map((m) => m.type)).toEqual(['setPack', 'setFonts', 'load']);
    await act(async () => root.unmount());
  });

  it('iOS content-process loss reloads the same WebView (no remount)', async () => {
    const { root } = await mount(() => docA);
    await fromWeb(root, { v: 1, type: 'ready' });
    await act(async () => webview(root).props.onContentProcessDidTerminate());
    expect(webviewMock.reloads).toBe(1);
    expect(webviewMock.mounts).toBe(1);
    await act(async () => root.unmount());
  });
});

describe('EditorView: fonts go one face per message (Gaegu is ~4.2 M chars per face)', () => {
  it('sends a replace message, then appends, each under MAX_BRIDGE_CHARS', async () => {
    webviewMock.reset();
    const big = (n: number) => 'A'.repeat(n);
    const faces = [
      { family: 'Gaegu', weight: 400, style: 'normal', base64: big(4_219_900) },
      { family: 'Gaegu', weight: 700, style: 'normal', base64: big(3_949_040) },
      { family: 'Nunito', weight: 400, style: 'normal', base64: big(176_268) },
    ] as const;
    const root = createRoot();
    await act(async () => {
      root.render(<EditorView logger={createLogger({ sink: memorySink() })} pack={pack} faces={faces} getDoc={() => docA} />);
    });
    await fromWeb(root, { v: 1, type: 'ready' });
    const fontMsgs = webviewMock.posted.filter((m) => m.includes('"setFonts"'));
    expect(fontMsgs).toHaveLength(3);
    expect(fontMsgs.every((m) => m.length <= MAX_BRIDGE_CHARS)).toBe(true);
    expect(fontMsgs.map((m) => (JSON.parse(m) as { append?: boolean }).append)).toEqual([false, true, true]);
    for (const m of fontMsgs) expect(decode(m, toWebSchema).ok).toBe(true);
    await act(async () => root.unmount());
  });
});

