/**
 * A non-interactive rendering of a note page in a style pack.
 * JavaScript is OFF, nothing can navigate (links included: Apple
 * age-rating rule), and touches pass through to the parent.
 */
import { StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import type { NoteDoc } from '@/core';
import type { FontFaceData, StylePack } from '@/modules/stylepacks';

import { previewHtml } from './preview';
import { allowNavigation, HARDENED_WEBVIEW_PROPS } from './webviewPolicy';

const HostWebView = WebView<object>;

export function PagePreview(props: {
  doc: NoteDoc;
  pack: StylePack;
  faces: readonly FontFaceData[];
  /** Fixed height; omit to fill the parent (flex: 1). */
  height?: number;
  zoom?: number;
  label: string;
  /** Scrollable full page (note screen); otherwise a static thumbnail. Links never open either way. */
  scrollable?: boolean;
}) {
  const scrollable = props.scrollable ?? false;
  return (
    <View
      style={[styles.box, props.height ? { height: props.height } : styles.fill, { backgroundColor: props.pack.paper.color }]}
      pointerEvents={scrollable ? 'auto' : 'none'}
      accessible={!scrollable}
      accessibilityLabel={props.label}
    >
      <HostWebView
        style={styles.web}
        source={{ html: previewHtml(props.doc, props.pack, props.faces, props.zoom ?? 0.6) }}
        {...HARDENED_WEBVIEW_PROPS}
        javaScriptEnabled={false}
        scrollEnabled={scrollable}
        onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest) => allowNavigation(req.url)}
        onOpenWindow={() => undefined}
        importantForAccessibility={scrollable ? 'auto' : 'no-hide-descendants'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', borderRadius: 12 },
  fill: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
});
