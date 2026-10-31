import { GOLDEN_CARD_ID, GOLDEN_CREATED_AT, GOLDEN_EXPECTED, GOLDEN_SEQUENCE } from './golden';
import { mergeLogs, rebuildSnapshot, type ReviewLog } from './logs';
import { snapshot, toRating, type CardSnapshot, type Scheduler } from './scheduler';

export function goldenSnapshots(scheduler: Scheduler): CardSnapshot[] {
  const created = new Date(GOLDEN_CREATED_AT);
  let card = scheduler.newCard({ now: created, cardId: GOLDEN_CARD_ID });
  const out: CardSnapshot[] = [];
  for (const [min, grade] of GOLDEN_SEQUENCE) {
    card = scheduler.review({ card, grade: toRating(grade), now: new Date(created.getTime() + min * 60_000) }).card;
    out.push(snapshot(card));
  }
  return out;
}

export function goldenLogs(): ReviewLog[] {
  const created = new Date(GOLDEN_CREATED_AT).getTime();
  return GOLDEN_SEQUENCE.map(([min, grade], i) => ({
    id: `l_golden${String(i).padStart(8, '0')}`,
    cardId: GOLDEN_CARD_ID,
    reviewedAt: new Date(created + min * 60_000).toISOString(),
    grade,
  }));
}

export interface SelfTestReport {
  pass: boolean;
  goldenMatches: number;
  goldenTotal: number;
  firstMismatch: string | null;
  mergeOrderIndependent: boolean;
  replayMatchesLive: boolean;
  reviewsPerSecond: number;
  ms: number;
}

const eq = (a: CardSnapshot, b: CardSnapshot) => JSON.stringify(a) === JSON.stringify(b);

/** Runs entirely on the device's JS engine; returns metrics only. */
export function runFsrsSelfTest(scheduler: Scheduler, clock: () => number = Date.now): SelfTestReport {
  const t0 = clock();
  const live = goldenSnapshots(scheduler);
  let matches = 0;
  let firstMismatch: string | null = null;
  live.forEach((s, i) => {
    const exp = GOLDEN_EXPECTED[i];
    if (exp && eq(s, exp)) matches++;
    else if (!firstMismatch) firstMismatch = `step ${i + 1}: got ${JSON.stringify(s)}`;
  });

  // Two devices hold overlapping halves of the log; merge both ways.
  const logs = goldenLogs();
  const deviceA = logs.filter((_, i) => i % 2 === 0).concat(logs.slice(0, 2));
  const deviceB = logs.filter((_, i) => i % 2 === 1).concat(logs.slice(-2));
  const created = new Date(GOLDEN_CREATED_AT);
  const ab = rebuildSnapshot(scheduler, GOLDEN_CARD_ID, created, mergeLogs(deviceA, deviceB));
  const ba = rebuildSnapshot(scheduler, GOLDEN_CARD_ID, created, mergeLogs(deviceB, deviceA));
  const lastLive = live[live.length - 1] as CardSnapshot;

  // Throughput: 2,000 reviews.
  const tp0 = clock();
  let card = scheduler.newCard({ now: created, cardId: 'c_throughput0001' });
  let at = created.getTime();
  for (let i = 0; i < 2000; i++) {
    at += 86_400_000;
    card = scheduler.review({ card, grade: toRating(((i % 4) + 1) as 1 | 2 | 3 | 4), now: new Date(at) }).card;
  }
  const tpMs = Math.max(1, clock() - tp0);

  const mergeOrderIndependent = eq(ab, ba);
  const replayMatchesLive = eq(ab, lastLive);
  return {
    pass: matches === GOLDEN_SEQUENCE.length && mergeOrderIndependent && replayMatchesLive,
    goldenMatches: matches,
    goldenTotal: GOLDEN_SEQUENCE.length,
    firstMismatch,
    mergeOrderIndependent,
    replayMatchesLive,
    reviewsPerSecond: Math.round((2000 / tpMs) * 1000),
    ms: clock() - t0,
  };
}
