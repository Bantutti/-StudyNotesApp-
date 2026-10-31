/** ink: pen/finger drawing with palm rejection and smoothness metrics. */
export { InkCanvas, type InkCanvasHandle } from './InkCanvas';
export { acceptPointer, POINTER, type InkMode } from './policy';
export { emptyInkStats, summarizeInk, judgeInk, histPercentile, type InkStats, type InkSummary } from './stats';
