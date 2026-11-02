/**
 * The Match a look flow without UI (P5 M5): picked photos -> cleaned
 * images -> on-device analysis -> nearest built-in pack -> a first matched
 * pack. The screen keeps the result in memory only; nothing here writes to
 * disk except the temporary image copies intakeImages always deletes.
 */
import type { RandomBytes } from '@/core';
import type { StylePack } from '@/modules/stylepacks';

import { analyzeImagesAsync, type AnalyzeProgress, type LookAnalysis } from './analysis/analyze';
import { buildPack } from './pack/builder';
import { newCustomPackId } from './pack/ids';
import { rankPacks } from './pack/nearest';
import { intakeImages, type ImageIntakePorts, type PickedImage } from './image/intake';

export interface MatchResult {
  id: string;
  analysis: LookAnalysis;
  /** Built-in packs ranked nearest first (§7); [0] is the base and the slider's default target. */
  ranked: { pack: StylePack; distance: number }[];
  /** The first matched pack (no chip choices yet). */
  matched: StylePack;
  /**
   * Clean, downsized JPEGs (base64) for the optional vision pass (M6), kept
   * in memory only and only when requested. Dropped with the screen.
   */
  visionImages: string[];
}

export async function runMatch(input: {
  picked: readonly PickedImage[];
  ports: ImageIntakePorts;
  builtIns: readonly StylePack[];
  randomBytes: RandomBytes;
  name: string;
  /** Prepare vision copies too (the vision feature flag is on). */
  keepVisionCopies: boolean;
  onProgress?: (p: AnalyzeProgress | { stage: 'cleaning' }) => void;
  signal?: AbortSignal;
}): Promise<MatchResult> {
  input.onProgress?.({ stage: 'cleaning' });
  const refs = await intakeImages(input.picked, input.ports, { vision: input.keepVisionCopies });
  const analysis = await analyzeImagesAsync(
    refs.map((r) => r.analysis),
    { onProgress: input.onProgress, signal: input.signal },
  );
  const ranked = rankPacks(analysis, input.builtIns);
  const base = (ranked[0] as { pack: StylePack }).pack;
  const id = newCustomPackId(input.randomBytes);
  const matched = buildPack({ id, name: input.name, analysis, base });
  return {
    id,
    analysis,
    ranked,
    matched,
    visionImages: input.keepVisionCopies ? refs.map((r) => r.visionJpegBase64).filter((b): b is string => !!b) : [],
  };
}
