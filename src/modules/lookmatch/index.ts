/**
 * lookmatch: "Match a look". A reference photo becomes a validated style pack.
 * Public interface only; everything else is internal (ARCHITECTURE module rule).
 * Maths: src/modules/lookmatch/MATCH_MATH.md (§ numbers in code comments).
 * Docs: docs/modules/lookmatch.md.
 */
export {
  intakeImages,
  checkPicked,
  cleanJpeg,
  intakeMessage,
  IntakeError,
  type PickedImage,
  type ReferenceImage,
  type ImageIntakePorts,
  type EncodedCopy,
  type IntakeProblem,
} from './image/intake';
export { stripJpegMetadata, metadataMarkers, isJpeg, JpegError } from './image/jpeg';
export * as IMAGE_LIMITS from './image/limits';
export { expoImagePorts, pickFromLibrary, takePhoto, type PickOutcome } from './image/expoImageAdapters';
export type { RgbaImage } from './analysis/pixels';
export { analyzeImages, analyzeImagesAsync, type LookAnalysis, type AnalyzeProgress } from './analysis/analyze';
export type { HighlighterGuess } from './analysis/roles';
export type { PaperType, PaperMargin, Texture } from './analysis/pattern';
