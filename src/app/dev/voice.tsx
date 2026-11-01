import * as Battery from 'expo-battery';
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Text, View } from 'react-native';

import { useServices } from '@/composition';
import { isExpoGo, round, t } from '@/core';
import { Banner, Body, Button, Card, Row, Screen, Segmented, Stat } from '@/core/ui';
import {
  deleteRecording,
  judgeRecording,
  keepRecording,
  listRecordings,
  PRESETS,
  summarize,
  type AppStateName,
  type PresetId,
  type RecordingFile,
  type Sample,
  type SessionSummary,
} from '@/modules/voice';

const SAMPLE_EVERY_MS = 15_000;

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const mb = (b: number) => `${(b / 1_000_000).toFixed(1)} MB`;

export default function VoiceSpike() {
  const [preset, setPreset] = useState<PresetId>('speech');
  const [files, setFiles] = useState<RecordingFile[]>(() => listRecordings());
  const refresh = () => setFiles(listRecordings());
  return (
    <Screen>
      {isExpoGo() ? (
        <Banner>
          You are in Expo Go. Recording works, but it stops when the screen locks. The real 90-minute test needs the
          Android development build (see TESTING_ON_DEVICE.md, section 4b).
        </Banner>
      ) : (
        <Banner tone="info">Development build: background recording is enabled. Lock the screen during the test.</Banner>
      )}
      <Segmented label="Quality" value={preset} options={(Object.keys(PRESETS) as PresetId[]).map((k) => ({ value: k, label: PRESETS[k].label }))} onChange={setPreset} />
      <Recorder key={preset} preset={preset} onSaved={refresh} />
      <Card title="Recordings on this phone">
        {files.length === 0 ? <Body muted>None yet.</Body> : null}
        {files.map((f) => (
          <View key={f.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: '#2F3448' }}>{f.name} · {mb(f.size)}</Text>
            <Button
              kind="danger"
              label="Delete"
              onPress={() =>
                Alert.alert('Delete recording?', 'This cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => { deleteRecording(f.name); refresh(); } },
                ])
              }
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}

function Recorder({ preset, onSaved }: { preset: PresetId; onSaved: () => void }) {
  const { results, logger } = useServices();
  const recorder = useAudioRecorder(PRESETS[preset].options);
  const state = useAudioRecorderState(recorder, 1000);
  const samples = useRef<Sample[]>([]);
  const paused = useRef(false);
  const [running, setRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [message, setMessage] = useState('');

  const takeSample = useCallback(async () => {
    const st = recorder.getStatus();
    let battery: number | null = null;
    try {
      battery = await Battery.getBatteryLevelAsync();
      if (battery < 0) battery = null;
    } catch {
      battery = null;
    }
    const s = AppState.currentState;
    const appState: AppStateName = s === 'active' || s === 'background' || s === 'inactive' ? s : 'unknown';
    samples.current.push({ wallMs: Date.now(), durationMs: st.durationMillis, fileSize: st.fileSize ?? 0, battery, appState, paused: paused.current });
  }, [recorder]);

  // Periodic samples, plus one whenever the app changes state (JS timers can pause in background).
  useEffect(() => {
    if (!running) return;
    const t = setInterval(takeSample, SAMPLE_EVERY_MS);
    const sub = AppState.addEventListener('change', () => void takeSample());
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [running, takeSample]);

  const start = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setMessage(t('mic.denied'));
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: !isExpoGo(), interruptionMode: 'doNotMix' });
    await recorder.prepareToRecordAsync();
    recorder.record();
    samples.current = [];
    paused.current = false;
    setIsPaused(false);
    setSummary(null);
    setMessage('');
    setRunning(true);
    logger.info('voice.record_start', { preset });
    setTimeout(() => void takeSample(), 500);
  };

  const togglePause = async () => {
    await takeSample();
    if (paused.current) {
      recorder.record();
      paused.current = false;
    } else {
      recorder.pause();
      paused.current = true;
    }
    setIsPaused(paused.current);
    await takeSample();
  };

  const stop = async () => {
    await takeSample();
    await recorder.stop();
    setRunning(false);
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
    const s = summarize(samples.current);
    setSummary(s);
    const uri = recorder.uri;
    if (uri) {
      try {
        keepRecording(uri);
        onSaved();
      } catch {
        logger.warn('voice.keep_failed');
        setMessage('Recording finished but could not be moved into the recordings folder.');
      }
    }
    logger.info('voice.record_stop', { minutes: round(s.recordedMs / 60_000, 1), coverage: round(s.coverage, 3) });
  };

  const save = async () => {
    if (!summary) return;
    const j = judgeRecording(summary);
    await results.record({
      spike: 'voice',
      verdict: j.verdict,
      summary: `${round(summary.recordedMs / 60_000, 1)} min, coverage ${(summary.coverage * 100).toFixed(1)}%, ${mb(summary.fileSize)}${j.reasons.length ? `; ${j.reasons[0]}` : ''}`,
      metrics: {
        preset,
        recorded_min: round(summary.recordedMs / 60_000, 2),
        wall_min: round(summary.wallMs / 60_000, 2),
        coverage_pct: round(summary.coverage * 100, 2),
        max_gap_s: round(summary.maxGapMs / 1000, 1),
        background_min: round(summary.backgroundMs / 60_000, 2),
        background_transitions: summary.backgroundTransitions,
        file_mb: round(summary.fileSize / 1_000_000, 2),
        mb_per_hour: round((summary.bytesPerMinute * 60) / 1_000_000, 2),
        projected_90min_mb: round(summary.projected90MinMB, 2),
        battery_per_hour_pct: summary.batteryPerHourPct === null ? -1 : round(summary.batteryPerHourPct, 1),
        samples: summary.samples,
        expo_go: isExpoGo(),
      },
    });
    setMessage('Saved to the results log.');
  };

  const verdict = summary ? judgeRecording(summary) : null;

  return (
    <Card title="Recorder">
      <Row>
        <Stat label="Recorded" value={fmtTime(state.durationMillis)} />
        <Stat label="File size" value={mb(state.fileSize ?? 0)} />
        <Stat label="Status" value={running ? (isPaused ? 'Paused' : 'Recording') : 'Stopped'} />
      </Row>
      {!running ? <Button label="Start recording" onPress={start} /> : null}
      {running ? (
        <Row>
          <View style={{ flex: 1 }}><Button kind="secondary" label={isPaused ? 'Resume' : 'Pause'} onPress={togglePause} /></View>
          <View style={{ flex: 1 }}><Button kind="danger" label="Stop" onPress={stop} /></View>
        </Row>
      ) : null}
      {summary && verdict ? (
        <>
          <Row>
            <Stat label="Coverage" value={`${(summary.coverage * 100).toFixed(1)}%`} />
            <Stat label="Longest gap" value={`${round(summary.maxGapMs / 1000, 1)} s`} />
            <Stat label="In background" value={fmtTime(summary.backgroundMs)} />
            <Stat label="90 min size" value={`${summary.projected90MinMB.toFixed(1)} MB`} />
            <Stat label="Battery/hour" value={summary.batteryPerHourPct === null ? 'n/a' : `${summary.batteryPerHourPct.toFixed(1)}%`} />
          </Row>
          <Body>Verdict: {verdict.verdict.toUpperCase()}{verdict.reasons.length ? `. ${verdict.reasons.join('; ')}.` : '.'}</Body>
          <Button label="Save result" onPress={save} />
        </>
      ) : null}
      {message ? <Body muted>{message}</Body> : null}
    </Card>
  );
}
