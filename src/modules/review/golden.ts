/**
 * Golden vectors for the on-device FSRS self-test.
 * GOLDEN_EXPECTED was computed in Node 24 with ts-fsrs 6.0.0 and the
 * SCHEDULER_CONFIG in scheduler.ts. The unit test re-checks it in Node;
 * the review spike re-checks it on the phone (Hermes).
 * If ts-fsrs or the config changes on purpose, regenerate with
 *   FSRS_PRINT_GOLDEN=1 npx jest src/modules/review
 * and paste the printed array here (see docs/modules/review.md).
 */
import type { CardSnapshot, Grade } from './scheduler';

export const GOLDEN_CARD_ID = 'c_golden00000001';
export const GOLDEN_CREATED_AT = '2026-01-05T08:00:00.000Z';

/** [minutes after creation, grade] */
export const GOLDEN_SEQUENCE: readonly (readonly [number, Grade])[] = [
  [0, 3],
  [10, 3],
  [60 * 24 * 2, 3],
  [60 * 24 * 9, 1],
  [60 * 24 * 9 + 10, 3],
  [60 * 24 * 12, 2],
  [60 * 24 * 25, 4],
  [60 * 24 * 80, 3],
];

export const GOLDEN_EXPECTED: readonly CardSnapshot[] = [
  { state: 2, reps: 1, lapses: 0, stability: 3.9221, difficulty: 3.530724, dueAt: '2026-01-10T02:39:55.164Z' },
  { state: 2, reps: 2, lapses: 0, stability: 5.691489, difficulty: 3.497717, dueAt: '2026-01-15T09:52:52.121Z' },
  { state: 2, reps: 3, lapses: 0, stability: 10.898558, difficulty: 3.46504, dueAt: '2026-02-02T23:29:46.600Z' },
  { state: 3, reps: 4, lapses: 1, stability: 2.503123, difficulty: 8.981742, dueAt: '2026-01-14T08:45:13.770Z' },
  { state: 2, reps: 5, lapses: 1, stability: 3.466358, difficulty: 8.894225, dueAt: '2026-01-15T08:10:00.000Z' },
  { state: 2, reps: 6, lapses: 1, stability: 5.515477, difficulty: 9.255285, dueAt: '2026-01-18T14:39:05.910Z' },
  { state: 2, reps: 7, lapses: 1, stability: 10.804056, difficulty: 8.863515, dueAt: '2026-02-04T18:07:36.738Z' },
  { state: 2, reps: 8, lapses: 1, stability: 24.746047, difficulty: 8.77718, dueAt: '2026-04-11T12:13:19.844Z' },
];
