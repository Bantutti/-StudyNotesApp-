import { GOLDEN_CARD_ID, GOLDEN_CREATED_AT, GOLDEN_EXPECTED } from '../golden';
import { mergeLogs, rebuildSnapshot, reviewLogSchema, sortLogs, type ReviewLog } from '../logs';
import { createScheduler, type Scheduler } from '../scheduler';
import { goldenLogs, goldenSnapshots, runFsrsSelfTest } from '../selfTest';

let s: Scheduler;
beforeAll(async () => {
  s = await createScheduler();
});

describe('FSRS golden values', () => {
  it('Node reproduces the committed golden snapshots', () => {
    const got = goldenSnapshots(s);
    if (process.env.FSRS_PRINT_GOLDEN) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(got));
    }
    expect(got).toEqual(GOLDEN_EXPECTED);
  });
  it('self-test passes in Node', () => {
    const r = runFsrsSelfTest(s);
    expect(r).toMatchObject({ pass: true, goldenMatches: 8, mergeOrderIndependent: true, replayMatchesLive: true });
    expect(r.reviewsPerSecond).toBeGreaterThan(100);
  });
});

describe('append-only logs', () => {
  const logs = goldenLogs();
  it('merge is a union: duplicates collapse and order does not matter', () => {
    const a = [logs[0]!, logs[2]!, logs[1]!];
    const b = [logs[1]!, logs[3]!, logs[0]!];
    expect(mergeLogs(a, b)).toEqual(mergeLogs(b, a));
    expect(mergeLogs(a, b)).toHaveLength(4);
  });
  it('ties on time are broken by id', () => {
    const t = '2026-01-01T00:00:00.000Z';
    const x: ReviewLog = { id: 'l_bbbbbbbbbb', cardId: GOLDEN_CARD_ID, reviewedAt: t, grade: 3 };
    const y: ReviewLog = { id: 'l_aaaaaaaaaa', cardId: GOLDEN_CARD_ID, reviewedAt: t, grade: 1 };
    expect(sortLogs([x, y]).map((l) => l.id)).toEqual(['l_aaaaaaaaaa', 'l_bbbbbbbbbb']);
  });
  it('rebuild ignores other cards and equals live scheduling', () => {
    const other: ReviewLog = { id: 'l_othercard0001', cardId: 'c_othercard00001', reviewedAt: '2026-01-06T00:00:00.000Z', grade: 1 };
    const snap = rebuildSnapshot(s, GOLDEN_CARD_ID, new Date(GOLDEN_CREATED_AT), [...logs, other]);
    expect(snap).toEqual(GOLDEN_EXPECTED[GOLDEN_EXPECTED.length - 1]);
  });
  it('log schema rejects bad grades and ids', () => {
    expect(reviewLogSchema.safeParse({ ...logs[0], grade: 5 }).success).toBe(false);
    expect(reviewLogSchema.safeParse({ ...logs[0], id: 'x' }).success).toBe(false);
    expect(reviewLogSchema.safeParse(logs[0]).success).toBe(true);
  });
});
