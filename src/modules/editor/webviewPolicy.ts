import type { WebViewProps } from 'react-native-webview';

/**
 * WebView hardening for the editor. The editor is a local, self-contained
 * HTML page: it never needs to navigate, open windows, or load any URL.
 */
export const ALLOWED_DOCUMENT_URLS = ['about:blank', 'about:srcdoc'] as const;

/** Every navigation other than the initial local document is refused. */
export function allowNavigation(url: string): boolean {
  return (ALLOWED_DOCUMENT_URLS as readonly string[]).includes(url);
}

/**
 * Props applied to <WebView>. Kept as data so a unit test can assert them.
 * See docs/SECURITY.md (Editor WebView) for the reasoning behind each one.
 */
export const HARDENED_WEBVIEW_PROPS: Partial<WebViewProps> = {
  originWhitelist: [...ALLOWED_DOCUMENT_URLS],
  javaScriptEnabled: true,
  domStorageEnabled: false,
  incognito: true,
  cacheEnabled: false,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  mixedContentMode: 'never',
  setSupportMultipleWindows: false,
  javaScriptCanOpenWindowsAutomatically: false,
  geolocationEnabled: false,
  allowsLinkPreview: false,
  allowsBackForwardNavigationGestures: false,
  dataDetectorTypes: 'none',
  mediaPlaybackRequiresUserAction: true,
  allowsInlineMediaPlayback: false,
  thirdPartyCookiesEnabled: false,
  sharedCookiesEnabled: false,
  saveFormDataDisabled: true,
  textZoom: 100,
  keyboardDisplayRequiresUserAction: false,
};
