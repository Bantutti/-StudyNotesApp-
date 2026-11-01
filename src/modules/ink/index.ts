/**
 * ink: drawing on notes (P4b). Public interface only; everything else in
 * this folder is internal. See docs/modules/ink.md and INK_MATH.md.
 */
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

// Input routing (stylus-aware mode, palm guards).
export { routePointer, penCancelsTouch, pastScrollSlop, PALM_AFTER_PEN_MS, PEN_CANCEL_WINDOW_MS, SCROLL_SLOP_PX, type InkInputMode, type Route, type RouteState } from './input/routing';

