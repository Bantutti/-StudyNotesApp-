import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useServices } from '@/composition';
import { getDeviceInfo } from '@/core';
import { Body, Button, Row, Segmented, Stat, ui } from '@/core/ui';
import { InkCanvas, judgeInk, summarizeInk, type InkCanvasHandle, type InkMode, type InkSummary } from '@/modules/ink';
import { DEFAULT_PACK_ID } from '@/modules/stylepacks';

export default function InkSpike() {
  const { packs, results } = useServices();
  const pack = packs.getOrDefault(DEFAULT_PACK_ID);
  const canvas = useRef<InkCanvasHandle>(null);
  const [mode, setMode] = useState<InkMode>('auto');
  const [pen, setPen] = useState(0);
  const [s, setS] = useState<InkSummary | null>(null);
  const [saved, setSaved] = useState('');
  const device = getDeviceInfo();

  useEffect(() => {
    const t = setInterval(() => {
      const raw = canvas.current?.readStats();
      if (raw) setS(summarizeInk(raw));
    }, 500);
    return () => clearInterval(t);
  }, []);

  const save = async () => {
    if (!s) return;
    const verdict = judgeInk(s);
    await results.record({
      spike: 'ink',
      verdict,
      summary: `${s.strokes} strokes, frame p50 ${s.frameP50Ms} ms / p95 ${s.frameP95Ms} ms, ${s.droppedFramePct}% dropped, ${s.pointsPerSecond} pts/s (${mode})`,
      metrics: {
        mode,
        tablet: device.isTablet,
        strokes: s.strokes,
        stylus_strokes: s.stylusStrokes,
        touch_strokes: s.touchStrokes,
        rejected_touches: s.rejectedTouches,
        points_per_second: s.pointsPerSecond,
        frame_p50_ms: s.frameP50Ms,
        frame_p95_ms: s.frameP95Ms,
        frame_max_ms: s.frameMaxMs,
        dropped_frame_pct: s.droppedFramePct,
        pressure_range: s.pressureRange,
      },
    });
    setSaved('Saved.');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <View style={styles.top}>
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
      </View>
      <View style={styles.canvas}>
        <InkCanvas ref={canvas} mode={mode} color={pack.ink.pens[pen] ?? pack.palette.ink} paper={pack.paper.color} />
      </View>
      <View style={styles.bottom}>
        <Row>
          <Stat label="Strokes" value={s ? `${s.strokes} (${s.stylusStrokes} pen)` : 0} />
          <Stat label="Frame p50/p95" value={s ? `${s.frameP50Ms}/${s.frameP95Ms} ms` : '—'} />
          <Stat label="Dropped" value={s ? `${s.droppedFramePct}%` : '—'} />
          <Stat label="Samples/s" value={s?.pointsPerSecond ?? '—'} />
          <Stat label="Rejected" value={s?.rejectedTouches ?? 0} />
        </Row>
        <Row>
          <View style={styles.flex}><Button kind="secondary" label="Clear" onPress={() => canvas.current?.clear()} /></View>
          <View style={styles.flex}><Button kind="secondary" label="Reset stats" onPress={() => { canvas.current?.resetStats(); setSaved(''); }} /></View>
          <View style={styles.flex}><Button label="Save result" onPress={save} /></View>
        </Row>
        <Body muted>{saved || 'Write 2 or 3 lines of notes, resting your palm on the screen as you normally would.'}</Body>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.canvas },
  top: { padding: 12, gap: 8 },
  canvas: { flex: 1, marginHorizontal: 12, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: ui.line },
  bottom: { padding: 12, gap: 8 },
  flex: { flex: 1 },
});
