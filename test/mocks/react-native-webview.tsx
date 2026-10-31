/** Jest stand-in for react-native-webview (a native module). Renders a plain View. */
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { View } from 'react-native';

type Props = { children?: ReactNode; testID?: string };

const WebView = forwardRef<{ postMessage(s: string): void; reload(): void }, Props>(function WebView(props, ref) {
  useImperativeHandle(ref, () => ({ postMessage: () => undefined, reload: () => undefined }));
  return <View testID={props.testID ?? 'webview'} />;
});

export default WebView;
export type WebViewMessageEvent = { nativeEvent: { data: string } };
