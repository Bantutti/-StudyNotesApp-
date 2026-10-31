import { useEffect, useMemo, useState } from 'react';

import { useServices } from '@/composition';
import { Banner, Body, Button, Card, Row, SampleBadge, Screen, Stat } from '@/core/ui';
import {
  createScheduler,
  GRADE_LABEL,
  rebuildCard,
  runFsrsSelfTest,
  type Grade,
  type ReviewLog,
  type Scheduler,
  type SelfTestReport,
} from '@/modules/review';

const CARD_ID = 'c_samplecard00001';
const isHermes = () => typeof (globalThis as { HermesInternal?: unknown }).HermesInternal === 'object';

function humanInterval(ms: number): string {
  const m = ms / 60_000;
  if (m < 60) return `${Math.max(1, Math.round(m))} min`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export default function ReviewSpike() {
  const { results, ids, logger } = useServices();
  const [scheduler, setScheduler] = useState<Scheduler | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [saved, setSaved] = useState('');
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [createdAt] = useState(() => new Date());

  useEffect(() => {
    createScheduler()
      .then(setScheduler)
      .catch(() => {
        logger.error('fsrs.init_failed');
        setLoadError(true);
      });
  }, [logger]);

  // Card state is always rebuilt from the append-only log.
  const card = useMemo(
    () => (scheduler ? rebuildCard(scheduler, CARD_ID, createdAt, logs) : null),
    [scheduler, createdAt, logs],
  );

  const previews = useMemo(() => {
    if (!scheduler || !card) return [];
    const now = new Date();
    return ([1, 2, 3, 4] as Grade[]).map((g) => {
      const next = scheduler.review({ card, grade: g, now }).card;
      return { g, label: GRADE_LABEL[g], interval: humanInterval(new Date(next.dueAt).getTime() - now.getTime()) };
    });
  }, [scheduler, card]);

  const grade = (g: Grade) =>
    setLogs((l) => [...l, { id: ids.newId('l'), cardId: CARD_ID, reviewedAt: new Date().toISOString(), grade: g }]);

  const runTest = () => {
    if (!scheduler) return;
    setReport(runFsrsSelfTest(scheduler));
  };

  const save = async () => {
    if (!report) return;
    await results.record({
      spike: 'review',
      verdict: report.pass ? 'pass' : 'fail',
      summary: `Golden ${report.goldenMatches}/${report.goldenTotal}, merge ${report.mergeOrderIndependent ? 'ok' : 'FAIL'}, ${report.reviewsPerSecond} reviews/s`,
      metrics: {
        hermes: isHermes(),
        golden_matches: report.goldenMatches,
        golden_total: report.goldenTotal,
        merge_order_independent: report.mergeOrderIndependent,
        replay_matches_live: report.replayMatchesLive,
        reviews_per_second: report.reviewsPerSecond,
        self_test_ms: report.ms,
        first_mismatch: report.firstMismatch ?? 'none',
      },
    });
    setSaved('Saved to the results log.');
  };

  return (
    <Screen>
      <Body muted>JS engine: {isHermes() ? 'Hermes' : 'not Hermes'}</Body>
      {loadError ? <Banner>ts-fsrs failed to start on this phone. That is a FAIL for this spike: save a note of it.</Banner> : null}
      <Card title="Self-test (golden values from Node)">
        <Body>Replays a fixed 8-review history and compares every step with values computed in Node. Then checks that the review logs from two devices merge to the same card in either order.</Body>
        <Button label="Run self-test" disabled={!scheduler} onPress={runTest} />
        {report ? (
          <>
            <Row>
              <Stat label="Golden steps" value={`${report.goldenMatches}/${report.goldenTotal}`} />
              <Stat label="Merge order" value={report.mergeOrderIndependent ? 'same' : 'DIFFERENT'} />
              <Stat label="Replay = live" value={report.replayMatchesLive ? 'yes' : 'NO'} />
              <Stat label="Speed" value={`${report.reviewsPerSecond}/s`} />
            </Row>
            {report.firstMismatch ? <Banner>First mismatch: {report.firstMismatch}</Banner> : null}
            <Button label="Save result" onPress={save} />
          </>
        ) : null}
        {saved ? <Body muted>{saved}</Body> : null}
      </Card>
      <Card title="Try it: one flashcard">
        <SampleBadge text="SAMPLE CARD" />
        <Body>Q: What moves during osmosis?</Body>
        <Body muted>A: Water, toward the higher solute concentration.</Body>
        <Row>
          {previews.map((p) => (
            <Button key={p.g} kind={p.g === 1 ? 'danger' : 'secondary'} label={`${p.label} · ${p.interval}`} onPress={() => grade(p.g)} />
          ))}
        </Row>
        <Body muted>
          Reviews logged: {logs.length}. State rebuilt from the log each time: reps {card?.reps ?? 0}, lapses {card?.lapses ?? 0}.
        </Body>
      </Card>
    </Screen>
  );
}
