/**
 * ink: drawing on notes (P4b). Public interface only; everything else in
 * this folder is internal. See docs/modules/ink.md and INK_MATH.md.
 */
// Draw-mode UI (overlay with the live stroke, toolbar).
export { InkOverlay, type InkOverlayProps, type OverlayTool } from './ui/InkOverlay';
export { InkToolbar, type InkToolbarProps } from './ui/InkToolbar';
export { INK_STRINGS, CUSTOM_PEN_COLOURS } from './ui/strings';

// P0 spike surface (kept for the Ink diagnostics screen) and its metrics.
export { InkCanvas, type InkCanvasHandle } from './InkCanvas';
export { acceptPointer, POINTER, type InkMode } from './policy';
export { emptyInkStats, summarizeInk, judgeInk, histPercentile, type InkStats, type InkSummary } from './stats';

// Model: format, limits, operations.
export { INK_LIMITS, INK_UNIT, PEN_KEYS, HIGHLIGHTER_KEYS, type PenKey, type HighlighterKey } from './model/limits';
export {
  emptyInkLayer,
  parseInkJson,
  validateInkLayer,
  serializeInk,
  inkUsage,
  type InkLayer,
  type InkStroke,
  type InkTombstone,
  type InkTool,
  type InkRecAnchor,
} from './model/format';
export { type InkPoint, type BlockBox } from './model/codec';
export { applyOp, inverseOp, detachedStrokes, type InkOp, type OpContext, type ApplyResult } from './model/layer';
export { createInkHistory, type InkHistory } from './model/history';
export { mergeInkLayers } from './model/merge';
export { pickAnchor, strokeToPx, widthPx, reexpress, indexLayout, type InkLayout, type LayoutBlock } from './model/anchors';
export { reconcile, type ReconcileResult } from './model/reconcile';
export { buildStrokes, type BuildInput } from './model/build';

// Rendering for the editor page and export (path data in block units).
export { renderStroke, renderLayer, renderDiff, type InkRenderItem } from './render';
export { SAFE_PATH } from './geometry/svg';

// Draw mode: tools, undo, reconcile (pure controller).
export {
  createInkController,
  DEFAULT_TOOLS,
  PEN_WIDTHS_PX,
  HIGHLIGHTER_WIDTH_PX,
  ERASER_RADIUS_PX,
  type InkController,
  type InkToolState,
  type InkToolName,
  type EraserMode,
  type InkViewLayout,
  type CommitResult,
} from './controller';

// Input routing (stylus-aware mode, palm guards).
export { routePointer, penCancelsTouch, pastScrollSlop, PALM_AFTER_PEN_MS, PEN_CANCEL_WINDOW_MS, SCROLL_SLOP_PX, type InkInputMode, type Route, type RouteState } from './input/routing';

// Service: local saving, publishing for sync, recovery.
export { createInkService, publishedPath, workingPath, WORKING_SAVE_DEBOUNCE_MS, type InkService, type InkSession, type PublishResult, type InkSource } from './service/inkService';
export { expoInkFiles } from './service/expoInkFiles';
export type { InkFilesPort, InkStorePort, InkNoteInfo, InkAssetInfo } from './service/ports';
