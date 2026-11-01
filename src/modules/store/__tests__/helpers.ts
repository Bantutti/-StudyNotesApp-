import { createLogger, createSeqIdGenerator, memorySink, type NoteDoc } from '@/core';

import { nodeSqliteDriver } from '../../../../test/nodeSqlite';
import { openStore } from '../store';

export interface TestClock {
  now: () => number;
  advance: (ms: number) => void;
}

export function clock(start = Date.UTC(2026, 10, 1, 2, 0, 0)): TestClock {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/** Ids long enough for P2a's entity pattern (16..64 chars). */
export function testIds() {
  const seq = createSeqIdGenerator();
  return seq;
}

export async function makeStore(opts: { path?: string; clock?: TestClock } = {}) {
  const c = opts.clock ?? clock();
  const sink = memorySink(500);
  const logger = createLogger({ sink, minLevel: 'debug' });
  const driver = nodeSqliteDriver(opts.path);
  const store = await openStore(driver, { ids: testIds(), logger, now: c.now });
  return { store, clock: c, sink, driver };
}

export const para = (text: string, blockId?: string) => ({
  type: 'paragraph' as const,
  attrs: { blockId: blockId ?? null },
  content: [{ type: 'text' as const, text }],
});

export const doc = (...content: NoteDoc['content']): NoteDoc => ({ type: 'doc', content });
