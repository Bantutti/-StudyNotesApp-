/**
 * Reference image intake: from "the student picked some photos" to
 * sanitized, small pixel buffers the analysis can read (P5 M2).
 *
 * Order of operations (cheapest and safest first):
 *   1. count, type and size checks on the picker's metadata (no decoding yet),
 *   2. re-encode a small copy (decoder downsamples while reading, so a big
 *      photo never sits in memory at full size),
 *   3. strip every metadata segment from the new JPEG (jpeg.ts),
 *   4. decode the clean JPEG to RGBA,
 *   5. delete every temporary file, in a finally block, whatever happened.
 * The original photo is never copied, kept, logged or uploaded (P5
 * decision Q5 = A). The optional vision copy (M6) stays in memory only.
 *
 * Platform work sits behind ImageIntakePorts (Expo adapter in
 * expoImageAdapters.ts), so this file is plain logic and unit-tested.
 */
import { base64ToBytes, bytesToBase64 } from '@/core';

import type { RgbaImage } from '../analysis/pixels';

import { isJpeg, metadataMarkers, stripJpegMetadata } from './jpeg';
import {
  ACCEPTED_MIME,
  ANALYSIS_LONG_SIDE,
  ANALYSIS_QUALITY,
  MAX_IMAGES,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  MAX_VISION_BASE64,
  MIN_INPUT_SIDE,
  VISION_LONG_SIDE,
  VISION_QUALITY,
} from './limits';

/** What the picker reports about one chosen file (metadata only). */
export interface PickedImage {
  uri: string;
  width: number;
  height: number;
  /** Bytes, when the platform knows it. */
  fileSize: number | null;
  mimeType: string | null;
  /** 'image' for photos; videos and live photos are refused. */
  type: string | null;
}

/** A re-encoded JPEG copy written to a temporary file. */
export interface EncodedCopy {
  uri: string;
  width: number;
  height: number;
  base64: string;
}

export interface ImageIntakePorts {
  /**
   * Decodes `uri` (downsampled while reading), shrinks it so the long side is
   * at most `longSide`, and re-encodes it as JPEG at `quality`.
   */
  encodeCopy(uri: string, source: { width: number; height: number }, longSide: number, quality: number): Promise<EncodedCopy>;
  /** Decodes a (clean) JPEG to non-premultiplied RGBA. */
  decodeJpeg(base64: string): RgbaImage;
  /** Deletes a temporary file. Must never throw; unknown or outside-cache paths are ignored. */
  removeTemp(uri: string): Promise<void>;
}

export type IntakeProblem = 'too_many' | 'not_image' | 'too_large' | 'too_many_pixels' | 'too_small' | 'unreadable';

export class IntakeError extends Error {
  constructor(
    readonly problem: IntakeProblem,
    /** 0-based index of the picked image the problem is about, or null for the whole selection. */
    readonly index: number | null,
  ) {
    super(`intake:${problem}`);
    this.name = 'IntakeError';
  }
}

/** One cleaned reference image. */
export interface ReferenceImage {
  /** Small RGBA copy for the on-device pass (long side ANALYSIS_LONG_SIDE). */
  analysis: RgbaImage;
  /** Clean JPEG (base64, no metadata) for the vision pass, or null when not requested. */
  visionJpegBase64: string | null;
}

/**
 * Step 1: refuses a selection before anything is decoded. Returns the first
 * problem found or null. Unknown sizes (null fileSize) are allowed here
 * and caught by the pixel check, which every platform reports.
 */
export function checkPicked(picked: readonly PickedImage[]): IntakeError | null {
  if (picked.length === 0 || picked.length > MAX_IMAGES) return new IntakeError('too_many', null);
  for (const [i, p] of picked.entries()) {
    if (p.type !== null && p.type !== 'image') return new IntakeError('not_image', i);
    if (p.mimeType !== null && !(ACCEPTED_MIME as readonly string[]).includes(p.mimeType.toLowerCase())) {
      return new IntakeError('not_image', i);
    }
    if (p.fileSize !== null && p.fileSize > MAX_INPUT_BYTES) return new IntakeError('too_large', i);
    if (!Number.isFinite(p.width) || !Number.isFinite(p.height) || p.width <= 0 || p.height <= 0) return new IntakeError('unreadable', i);
    if (p.width * p.height > MAX_INPUT_PIXELS) return new IntakeError('too_many_pixels', i);
    if (Math.min(p.width, p.height) < MIN_INPUT_SIDE) return new IntakeError('too_small', i);
  }
  return null;
}

/** Steps 3 and 3b: strip metadata, then refuse output that still carries any (defence in depth). */
export function cleanJpeg(base64: string): { bytes: Uint8Array; base64: string } {
  const raw = base64ToBytes(base64);
  if (!isJpeg(raw)) throw new IntakeError('unreadable', null);
  const bytes = stripJpegMetadata(raw);
  if (metadataMarkers(bytes).length > 0) throw new IntakeError('unreadable', null);
  return { bytes, base64: bytesToBase64(bytes) };
}

/** Decoded size must match what we asked for (a decoder bug or hostile file otherwise). */
function checkDecoded(img: RgbaImage, longSide: number): void {
  if (Math.max(img.width, img.height) > longSide || img.data.length !== img.width * img.height * 4) {
    throw new IntakeError('unreadable', null);
  }
}

/**
 * Steps 2-5 for a whole selection. Throws IntakeError (with the image
 * index) on the first bad image; temporary files are removed either way.
 */
export async function intakeImages(
  picked: readonly PickedImage[],
  ports: ImageIntakePorts,
  opts: { vision: boolean },
): Promise<ReferenceImage[]> {
  const problem = checkPicked(picked);
  if (problem) throw problem;
  const temps: string[] = [];
  try {
    const out: ReferenceImage[] = [];
    for (const [i, p] of picked.entries()) {
      try {
        const small = await ports.encodeCopy(p.uri, p, ANALYSIS_LONG_SIDE, ANALYSIS_QUALITY);
        temps.push(small.uri);
        const clean = cleanJpeg(small.base64);
        const analysis = ports.decodeJpeg(clean.base64);
        checkDecoded(analysis, ANALYSIS_LONG_SIDE);
        let visionJpegBase64: string | null = null;
        if (opts.vision) {
          const big = await ports.encodeCopy(p.uri, p, VISION_LONG_SIDE, VISION_QUALITY);
          temps.push(big.uri);
          const v = cleanJpeg(big.base64);
          if (v.base64.length > MAX_VISION_BASE64) throw new IntakeError('too_large', i);
          visionJpegBase64 = v.base64;
        }
        out.push({ analysis, visionJpegBase64 });
      } catch (e) {
        if (e instanceof IntakeError) throw new IntakeError(e.problem, e.index ?? i);
        throw new IntakeError('unreadable', i); // never leak decoder messages (they can contain paths)
      }
    }
    return out;
  } finally {
    // The picker's own cache copies are temporary too: never keep the photo (Q5 = A).
    for (const uri of [...temps, ...picked.map((p) => p.uri)]) await ports.removeTemp(uri);
  }
}

/** Plain-language message for each problem (shown on the Match a look screen). */
export function intakeMessage(e: IntakeError): string {
  const which = e.index === null ? 'One of the photos' : `Photo ${e.index + 1}`;
  switch (e.problem) {
    case 'too_many':
      return `Pick 1 to ${MAX_IMAGES} photos.`;
    case 'not_image':
      return `${which} isn't a photo. Pick a JPEG, PNG, WebP or HEIC image.`;
    case 'too_large':
      return `${which} is too large. Try a smaller photo or a screenshot.`;
    case 'too_many_pixels':
      return `${which} has too many pixels (over 50 megapixels). Try a screenshot of it.`;
    case 'too_small':
      return `${which} is too small to read. Pick a larger photo.`;
    case 'unreadable':
      return `${which} couldn't be read. Try another photo.`;
  }
}
