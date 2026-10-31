/**
 * Token estimate and chunking. Maths: ALGORITHMS.md §1.
 *
 * Why estimate on the device: we have no tokenizer for every model, and we
 * need a number BEFORE sending to (a) keep each request under Groq's free
 * 8,000 tokens-per-minute limit and (b) split long notes. The estimate is
 * deliberately pessimistic (it over-counts), which is the safe direction.
 */
import { utf8Length } from '@/core';

import type { Unit } from './units';

/** §1.1 bytes per token used for the estimate (real English ≈ 4; we use 3). */
export const BYTES_PER_TOKEN = 3;
/** §1.1 per-unit JSON overhead ({"ref":"u12","kind":...}). */
export const UNIT_OVERHEAD_TOKENS = 14;
/** §1.2 note data per request (Rey Nov 1: ~2.5K so a request stays < ~6K total). */
export const CHUNK_INPUT_BUDGET = 2_500;
/** §1.2 a single unit larger than this cannot be sent at all. */
export const MAX_UNIT_TOKENS = 4_000;
/** §1.2 more chunks than this is "too long; select a part". */
export const MAX_CHUNKS = 8;

/** §1.1 T(s) = ⌈bytes(s) / 3⌉ */
export function estimateTokens(s: string): number {
  return Math.ceil(utf8Length(s) / BYTES_PER_TOKEN);
}

/** §1.1 T(u) = T(text) + T(term) + overhead */
export function unitTokens(u: Pick<Unit, 'text' | 'term'>): number {
  return estimateTokens(u.text) + estimateTokens(u.term ?? '') + UNIT_OVERHEAD_TOKENS;
}

export type ChunkResult = { ok: true; chunks: Unit[][] } | { ok: false; reason: 'unit_too_large' | 'too_many_chunks' };

/**
 * §1.2 Greedy, order-preserving packing: add units to the current chunk until
 * the next one would exceed the budget, then start a new chunk. A unit that
 * is bigger than the budget (but under MAX_UNIT_TOKENS) gets a chunk alone.
 */
export function chunkUnits(units: readonly Unit[], budget = CHUNK_INPUT_BUDGET, maxChunks = MAX_CHUNKS): ChunkResult {
  const chunks: Unit[][] = [];
  let current: Unit[] = [];
  let used = 0;
  for (const u of units) {
    const t = unitTokens(u);
    if (t > MAX_UNIT_TOKENS) return { ok: false, reason: 'unit_too_large' };
    if (current.length > 0 && used + t > budget) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(u);
    used += t;
  }
  if (current.length > 0) chunks.push(current);
  if (chunks.length > maxChunks) return { ok: false, reason: 'too_many_chunks' };
  return { ok: true, chunks };
}

/** Sum of unit tokens in a chunk. */
export function chunkTokens(chunk: readonly Unit[]): number {
  return chunk.reduce((s, u) => s + unitTokens(u), 0);
}
