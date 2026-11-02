/**
 * Developer menu > Ink diagnostics (P4b M9). Produces the numbers Rey's
 * end-of-build device test needs (P0's ink results were never collected):
 *  1. Live drawing: the P0 canvas with frame p50/p95/max, dropped frames,
 *     samples per second, pen vs finger strokes, pressure range, and
 *     rejected palm touches. Palm test: write 10 lines with your palm resting.
 *  2. Latency: a running millisecond clock to film at 240 fps next to the pen
 *     (touch-to-ink latency can't be measured from inside the app).
 *  3. Engine bench on SYNTHETIC strokes (labelled): build, save, open,
 *     render, eraser and lasso hit tests, merge, on this device's engine.
 * "Save result" stores METRICS ONLY (no strokes) in the results file.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useServices } from '@/composition';
import { getDeviceInfo } from '@/core';
import { Banner, Body, Button, Card, Row, Segmented, Stat, ui } from '@/core/ui';
import {
  InkCanvas,
  judgeBench,
  judgeInk,
  runInkBench,
  summarizeInk,
  BENCH_TARGETS,
  type BenchResult,
  type InkCanvasHandle,
  type InkMode,
  type InkSummary,
} from '@/modules/ink';
import { DEFAULT_PACK_ID } from '@/modules/stylepacks';

export default function InkDiagnostics() {
  const { packs, results } = useServices();
  const pack = packs.getOrDefault(DEFAULT_PACK_ID);
  const canvas = useRef<InkCanvasHandle>(null);
  const [mode, setMode] = useState<InkMode>('auto');
  const [pen, setPen] = useState(0);
  const [s, setS] = useState<InkSummary | null>(null);
  const [bench, setBench] = useState<BenchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [clock, setClock] = useState(0);
  const [clockOn, setClockOn] = useState(false);
  const device = getDeviceInfo();

  useEffect(() => {
    const t = setInterval(() => {
      const raw = canvas.current?.readStats();
      if (raw) setS(summarizeInk(raw));
    }, 500);
    return () => clearInterval(t);
  }, []);

  // A millisecond clock for the slow-motion latency test (updates every frame while on).
  useEffect(() => {
    if (!clockOn) return;
    let h = 0;
    const tick = () => {
      setClock(Date.now() % 100_000);
      h = requestAnimationFrame(tick);
    };
    h = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(h);
  }, [clockOn]);

  const runBench = () => {
    setBusy(true);
    // Let the button show "Running" before the (blocking) bench starts.
    setTimeout(() => {
      setBench(runInkBench({ strokes: 5_000 }));
      setBusy(false);
    }, 50);
  };

  const save = async () => {
    const ink = s;
    const verdict = ink && bench ? (judgeInk(ink) === 'fail' || judgeBench(bench) === 'fail' ? 'fail' : judgeInk(ink)) : ink ? judgeInk(ink) : bench ? judgeBench(bench) : 'info';
    await results.record({
      spike: 'ink',
      verdict,
      summary: [
        ink ? `${ink.strokes} strokes, frame p50 ${ink.frameP50Ms} / p95 ${ink.frameP95Ms} ms, ${ink.droppedFramePct}% dropped, ${ink.pointsPerSecond} pts/s, ${ink.rejectedTouches} palm touches rejected (${mode})` : '',
        bench ? `bench (synthetic ${bench.strokes} strokes): parse ${bench.parseMs} ms, render ${bench.renderMs} ms, eraser ${bench.eraseHitMs} ms` : '',
      ]
        .filter(Boolean)
        .join('; ')
        .slice(0, 400),
      metrics: {
        mode,
        tablet: device.isTablet,
        ...(ink
          ? {
              strokes: ink.strokes,
              stylus_strokes: ink.stylusStrokes,
              touch_strokes: ink.touchStrokes,
              rejected_touches: ink.rejectedTouches,
              points_per_second: ink.pointsPerSecond,
              frame_p50_ms: ink.frameP50Ms,
              frame_p95_ms: ink.frameP95Ms,
              frame_max_ms: ink.frameMaxMs,
              dropped_frame_pct: ink.droppedFramePct,
              pressure_range: ink.pressureRange,
            }
          : {}),
        ...(bench
          ? {
              bench_synthetic: true,
              bench_strokes: bench.strokes,
              bench_points: bench.points,
              bench_file_bytes: bench.fileBytes,
              bench_build_ms: bench.buildMs,
              bench_serialize_ms: bench.serializeMs,
              bench_parse_ms: bench.parseMs,
              bench_render_ms: bench.renderMs,
              bench_erase_hit_ms: bench.eraseHitMs,
              bench_lasso_ms: bench.lassoMs,
              bench_merge_ms: bench.mergeMs,
            }
          : {}),
      },
    });
    setSaved('Saved. Results > Copy results to paste them back.');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      {/* The drawing box sits inside a ScrollView: draw inside the box, scroll outside it. */}
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card title="1. Live drawing and palm test">
          <Segmented
            label="Palm rejection"
            value={mode}
            options={[
              { value: 'auto', label: 'Auto (after pen seen)' },
              { value: 'stylus', label: 'Stylus only' },
              { value: 'any', label: 'Off' },
            ]}
            onChange={setMode}
          />
          <Segmented label="Pen" value={String(pen)} options={pack.ink.pens.map((_, i) => ({ value: String(i), label: `Pen ${i + 1}` }))} onChange={(v) => setPen(Number(v))} />
          <View style={styles.canvas}>
            <InkCanvas ref={canvas} mode={mode} color={pack.ink.pens[pen] ?? pack.palette.ink} paper={pack.paper.color} />
          </View>
          <Row>
            <Stat label="Strokes" value={s ? `${s.strokes} (${s.stylusStrokes} pen)` : 0} />
            <Stat label="Frame p50/p95" value={s ? `${s.frameP50Ms}/${s.frameP95Ms} ms` : '—'} />
            <Stat label="Dropped" value={s ? `${s.droppedFramePct}%` : '—'} />
          </Row>
          <Row>
            <Stat label="Samples/s" value={s?.pointsPerSecond ?? '—'} />
            <Stat label="Palm rejected" value={s?.rejectedTouches ?? 0} />
            <Stat label="Pressure" value={s?.pressureRange ?? '—'} />
          </Row>
          <Row>
            <View style={styles.flex}><Button kind="secondary" label="Clear" onPress={() => canvas.current?.clear()} /></View>
            <View style={styles.flex}><Button kind="secondary" label="Reset stats" onPress={() => { canvas.current?.resetStats(); setSaved(''); }} /></View>
          </Row>
          <Body muted>Palm test: write 10 lines of notes with your palm resting on the screen as you normally would. Count marks you didn&apos;t mean to make.</Body>
        </Card>

        <Card title="2. Touch-to-ink latency (slow-motion video)">
          <Body>Film the screen at 240 fps (most phones: Camera, Slow-mo). Draw a fast line while the clock runs. In the video, count frames between the pen tip moving and the ink appearing: each frame is about 4.2 ms.</Body>
          <Text style={styles.clock} accessibilityLabel="Millisecond clock">{clockOn ? String(clock).padStart(5, '0') : '-----'}</Text>
          <Button kind="secondary" label={clockOn ? 'Stop clock' : 'Start clock'} onPress={() => setClockOn((c) => !c)} />
        </Card>

        <Card title="3. Engine bench (synthetic strokes)">
          <Banner tone="info">Uses 5,000 generated strokes, not your notes. It shows how fast this device opens, draws and erases a very full drawing.</Banner>
          <Button label={busy ? 'Running...' : 'Run bench'} onPress={runBench} disabled={busy} />
          {bench ? (
            <>
              <Row>
                <Stat label="Strokes / points" value={`${bench.strokes} / ${bench.points}`} />
                <Stat label="File" value={`${Math.round(bench.fileBytes / 1024)} KB`} />
              </Row>
              <Row>
                <Stat label={`Open (≤ ${BENCH_TARGETS.parseMs} ms)`} value={`${bench.parseMs} ms`} />
                <Stat label={`Render (≤ ${BENCH_TARGETS.renderMs} ms)`} value={`${bench.renderMs} ms`} />
              </Row>
              <Row>
                <Stat label={`Eraser (≤ ${BENCH_TARGETS.eraseHitMs} ms)`} value={`${bench.eraseHitMs} ms`} />
                <Stat label={`Lasso (≤ ${BENCH_TARGETS.lassoMs} ms)`} value={`${bench.lassoMs} ms`} />
              </Row>
              <Row>
                <Stat label="Build" value={`${bench.buildMs} ms`} />
                <Stat label="Save" value={`${bench.serializeMs} ms`} />
                <Stat label="Merge" value={`${bench.mergeMs} ms`} />
              </Row>
              <Body muted>Verdict: {judgeBench(bench).toUpperCase()} (targets are first guesses; tell the developer your numbers).</Body>
            </>
          ) : null}
        </Card>

        <Button label="Save result" onPress={save} />
        <Body muted>{saved || 'Results hold numbers only, never your drawing.'}</Body>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.canvas },
  scroll: { padding: 12, gap: 12 },
  canvas: { height: 320, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: ui.line },
  flex: { flex: 1 },
  clock: { fontSize: 56, fontVariant: ['tabular-nums'], textAlign: 'center', fontWeight: '700' },
});
