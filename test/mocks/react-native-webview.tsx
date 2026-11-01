/**
 * Jest stand-in for react-native-webview (a native module). Renders a plain
 * View that carries the WebView's event props (onMessage, onRenderProcessGone,
 * onContentProcessDidTerminate) so tests can fire them, and records what the
 * native side posts, mounts and reloads in `webviewMock`.
 */
import { forwardRef, useEffect, useImperativeHandle, type ReactNode } from 'react';
import { View } from 'react-native';

type Props = {
  children?: ReactNode;
  testID?: string;
  onMessage?: (e: WebViewMessageEvent) => void;
  onRenderProcessGone?: () => unknown;
  onContentProcessDidTerminate?: () => void;
};

export const webviewMock = {
  posted: [] as string[],
  mounts: 0,
  reloads: 0,
  reset() {
    this.posted = [];
    this.mounts = 0;
    this.reloads = 0;
  },
};

const WebView = forwardRef<{ postMessage(s: string): void; reload(): void }, Props>(function WebView(props, ref) {
  useImperativeHandle(ref, () => ({
    postMessage: (s: string) => void webviewMock.posted.push(s),
    reload: () => void (webviewMock.reloads += 1),
  }));
  useEffect(() => {
    webviewMock.mounts += 1;
  }, []);
  return (
    <View
      testID={props.testID ?? 'webview'}
      {...({
        onMessage: props.onMessage,
        onRenderProcessGone: props.onRenderProcessGone,
        onContentProcessDidTerminate: props.onContentProcessDidTerminate,
      } as object)}
    />
  );
});

export default WebView;
export type WebViewMessageEvent = { nativeEvent: { data: string } };
