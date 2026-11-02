/** Shared test helpers for the ink module (not shipped: only imported by tests). */
import { createSeqIdGenerator } from '@/core';

import { emptyInkLayer, type InkLayer, type InkStroke } from '../model/format';
import type { OpContext } from '../model/layer';

export const NOTE = 'n_0000000000000001';
export const B1 = 'b_AAAAAAAAAA01';
export const B2 = 'b_AAAAAAAAAA02';
export const B3 = 'b_AAAAAAAAAA03';

/** Deterministic PRNG (mulberry32) for seeded property tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An op context with sequential stroke ids ("s_000…1") and a controllable clock. */
export function ctx(start = 1_760_000_000_000): OpContext & { advance(ms: number): void } {
  const ids = createSeqIdGenerator();
  let t = start;
  return { newStrokeId: () => ids.newId('s'), now: () => t, advance: (ms) => (t += ms) };
}

let n = 0;
/** A small valid stroke. */
export function stroke(over: Partial<InkStroke> = {}): InkStroke {
  n += 1;
  return {
    id: `s_T${String(n).padStart(15, '0')}`,
    b: B1,
    tool: 'pen',
    c: 'p0',
    w: 30,
    o: [100, 20],
    d: [10, 0, 10, 5, 5, 5],
    t: 1_760_000_000_000 + n,
    ...over,
  };
}

export function layerWith(strokes: InkStroke[], gone: InkLayer['gone'] = []): InkLayer {
  return { ...emptyInkLayer(NOTE), strokes, gone };
}
