/**
 * Timestamp checks for audio-synced notes.
 *
 * 1. Structural: word times are ordered, inside the audio, non-negative.
 * 2. Tap-along drift: while audio plays, the user taps when they hear a
 *    prompted word. offset = tapTime - word.start. Human reaction time
 *    (~150-300 ms) is included in the raw numbers, so we report the median
 *    and the spread; a stable median means timestamps are consistent.
 * 3. Tap-to-seek: user marks whether playback started at the tapped word.
 */
import { mad, median, percentile } from '@/core';

export interface TimedWord {
  word: string;
  start: number; // seconds
  end: number;
}

export interface StructureReport {
  words: number;
  ordered: boolean;
  withinAudio: boolean;
  zeroLength: number;
  coverage: number; // fraction of duration inside some word
}

export function checkStructure(words: readonly TimedWord[], durationSec: number): StructureReport {
  let ordered = true;
  let within = true;
  let zero = 0;
  let covered = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as TimedWord;
    if (w.end < w.start) ordered = false;
    if (i > 0 && w.start + 0.001 < (words[i - 1] as TimedWord).start) ordered = false;
    if (w.start < 0 || w.end > durationSec + 0.5) within = false;
    if (w.end - w.start <= 0.001) zero++;
    covered += Math.max(0, w.end - w.start);
  }
  return {
    words: words.length,
    ordered,
    withinAudio: within,
    zeroLength: zero,
    coverage: durationSec > 0 ? Math.min(1, covered / durationSec) : 0,
  };
}

/** Picks spaced-out target words for the tap-along test. */
export function pickTargets(words: readonly TimedWord[], count = 8, minGapSec = 2.5): number[] {
  const out: number[] = [];
  let lastStart = -Infinity;
  const step = Math.max(1, Math.floor(words.length / (count + 1)));
  for (let i = step; i < words.length && out.length < count; i += step) {
    const w = words[i] as TimedWord;
    if (w.word.replace(/[^A-Za-z\u00C0-\u024F]/g, '').length >= 4 && w.start - lastStart >= minGapSec) {
      out.push(i);
      lastStart = w.start;
    }
  }
  return out;
}

export interface DriftReport {
  taps: number;
  medianOffsetMs: number;
  madMs: number;
  p90AbsMs: number;
}

export function driftStats(offsetsSec: readonly number[]): DriftReport {
  const ms = offsetsSec.map((s) => s * 1000);
  return {
    taps: ms.length,
    medianOffsetMs: Math.round(median(ms)),
    madMs: Math.round(mad(ms)),
    p90AbsMs: Math.round(percentile(ms.map(Math.abs), 90)),
  };
}

/** Index of the word playing at time t (seconds), or -1. */
export function wordAt(words: readonly TimedWord[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((words[mid] as TimedWord).start <= t) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}
