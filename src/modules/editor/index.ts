/** editor: TipTap in a hardened WebView, driven by a validated bridge. */
export { EditorView, type EditorHandle, type EditorEvents, type EditorState, type InkLayoutMessage } from './EditorView';
export { COMMANDS, PROTOCOL_VERSION, MAX_BRIDGE_CHARS, decode, encode, toNativeSchema, toWebSchema } from './protocol';
export type { EditorCommand, ToNative, ToWeb, DiagEvent, BlockKind, InkItem, InkBlockBox } from './protocol';
export { INK_PATH_CHARS, INK_MAX_PATH_CHARS, INK_MAX_ITEMS, chunkInkItems } from './protocol';
export { BLOCK_KINDS, DIAG_KINDS, diagEventSchema } from './protocol';
export { allowNavigation, HARDENED_WEBVIEW_PROPS } from './webviewPolicy';
export { EDITOR_CSP, EDITOR_SCRIPT_SHA256, EDITOR_SCRIPT_BYTES } from './generated/editorHtml';
export { createLinkOpener, linkHost, type LinkOpener, type LinkOpenResult, type LinkPorts } from './links';
export { expoLinkPorts } from './expoLinkPorts';
export { PagePreview } from './PagePreview';
export { previewHtml } from './preview';
export {
  createEditorActionRegistry,
  type EditorAction,
  type EditorActionContext,
  type EditorActionPlacement,
  type EditorActionReason,
  type EditorActionRegistry,
  type EditorActionResult,
  type EditorHost,
} from './actions';
