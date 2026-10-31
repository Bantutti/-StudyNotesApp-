import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useServices } from '@/composition';
import { round, userMessage } from '@/core';
import { Banner, Body, Button, Card, Row, SampleBadge, Screen, Segmented, Stat, ui } from '@/core/ui';
import {
  checkStructure,
  driftStats,
  listRecordings,
  pickTargets,
  READING_SCRIPTS,
  SAMPLE_GLOSSARY,
  wordAt,
  wordErrorRate,
  type ReadingScript,
  type Transcript,
} from '@/modules/voice';

type ScriptChoice = ReadingScript['id'] | 'none';

export default function TimestampSpike() {
  const { transcriber, keyVault, results } = useServices();
  const router = useRouter();
  const files = useMemo(() => listRecordings(), []);
  const [fileName, setFileName] = useState(files[0]?.name ?? '');
  const [scriptId, setScriptId] = useState<ScriptChoice>('en');
  const [useGlossary, setUseGlossary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tx, setTx] = useState<Transcript | null>(null);
  const [seekMarks, setSeekMarks] = useState<boolean[]>([]);
  const [drift, setDrift] = useState<{ targets: number[]; at: number; offsets: number[] } | null>(null);
  const [saved, setSaved] = useState('');

  const file = files.find((f) => f.name === fileName);
  const script = READING_SCRIPTS.find((s) => s.id === scriptId);
  const player = useAudioPlayer(file ? { uri: file.uri } : null);
  const status = useAudioPlayerStatus(player);

  const structure = tx ? checkStructure(tx.words, tx.durationSec || status.duration) : null;
  const wer = tx && script ? wordErrorRate(script.text, tx.text) : null;
  const playingIdx = tx && status.playing ? wordAt(tx.words, status.currentTime) : -1;

  const transcribe = async () => {
    if (!file) return;
    if (!(await keyVault.has('groq'))) {
      Alert.alert('Groq key needed', 'Add your free Groq key first.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open settings', onPress: () => router.push('/settings') },
      ]);
      return;
    }
    // Explicit consent: this is the only P0 feature that sends user data off the phone.
    const ok = await new Promise<boolean>((resolve) =>
      Alert.alert(
        'Upload this recording to Groq?',
        'The audio file is sent to Groq (a third-party AI provider) with your own key, to make a transcript. Nothing is sent to us.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Upload', onPress: () => resolve(true) },
        ],
      ),
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    setTx(null);
    setDrift(null);
    setSeekMarks([]);
    try {
      const r = await transcriber.transcribe({
        fileUri: file.uri,
        fileName: file.name,
        mimeType: 'audio/m4a',
        language: script?.language ?? '',
        prompt: useGlossary ? SAMPLE_GLOSSARY : undefined,
      });
      setTx(r);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const seekTo = async (i: number) => {
    if (!tx) return;
    const w = tx.words[i];
    if (!w) return;
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    player.seekTo(Math.max(0, w.start - 0.05));
    player.play();
  };

  const startDrift = async () => {
    if (!tx) return;
    const targets = pickTargets(tx.words);
    setDrift({ targets, at: 0, offsets: [] });
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    player.seekTo(0);
    player.play();
  };

  const tapNow = () => {
    if (!drift || !tx) return;
    const idx = drift.targets[drift.at];
    if (idx === undefined) return;
    const w = tx.words[idx];
    if (!w) return;
    const offsets = [...drift.offsets, status.currentTime - w.start];
    const at = drift.at + 1;
    setDrift({ ...drift, at, offsets });
    if (at >= drift.targets.length) player.pause();
  };

  const d = drift && drift.offsets.length ? driftStats(drift.offsets) : null;
  const seekPct = seekMarks.length ? seekMarks.filter(Boolean).length / seekMarks.length : null;

  const save = async () => {
    if (!tx || !structure) return;
    const pass = structure.ordered && structure.withinAudio && (seekPct ?? 0) >= 0.8 && (d ? d.madMs < 250 : false);
    await results.record({
      spike: 'timestamps',
      verdict: !d || seekPct === null ? 'info' : pass ? 'pass' : 'fail',
      summary: `WER ${wer ? (wer.wer * 100).toFixed(1) + '%' : 'n/a'} (${script?.label ?? 'no script'}), seek ok ${seekPct === null ? 'n/a' : Math.round(seekPct * 100) + '%'}, drift median ${d?.medianOffsetMs ?? 'n/a'} ms`,
      metrics: {
        script: script?.id ?? 'none',
        language_hint: script?.language || 'auto',
        detected_language: tx.language.slice(0, 20),
        glossary: useGlossary,
        audio_s: round(tx.durationSec, 1),
        api_latency_ms: tx.latencyMs,
        words: structure.words,
        ordered: structure.ordered,
        within_audio: structure.withinAudio,
        zero_length_words: structure.zeroLength,
        word_coverage_pct: round(structure.coverage * 100, 1),
        wer_pct: wer ? round(wer.wer * 100, 1) : -1,
        seek_checks: seekMarks.length,
        seek_ok_pct: seekPct === null ? -1 : round(seekPct * 100, 0),
        drift_taps: d?.taps ?? 0,
        drift_median_ms: d?.medianOffsetMs ?? -1,
        drift_mad_ms: d?.madMs ?? -1,
        drift_p90_abs_ms: d?.p90AbsMs ?? -1,
      },
    });
    setSaved('Saved to the results log (metrics only, no transcript text).');
  };

  return (
    <Screen>
      <Body muted>Record yourself reading a script on the 90-min recording screen (a 1 to 2 minute clip is enough), then come back here.</Body>
      {files.length === 0 ? <Banner>No recordings yet. Make one on the recording screen first.</Banner> : null}
      {files.length > 0 ? (
        <Segmented label="Recording" value={fileName} options={files.slice(0, 6).map((f) => ({ value: f.name, label: f.name.replace('rec-', '').replace('.m4a', '') }))} onChange={setFileName} />
      ) : null}
      <Segmented
        label="Script you read"
        value={scriptId}
        options={[...READING_SCRIPTS.map((s) => ({ value: s.id as ScriptChoice, label: s.label })), { value: 'none' as ScriptChoice, label: 'Free speech' }]}
        onChange={setScriptId}
      />
      {script ? (
        <Card title={`Reading script: ${script.label}`}>
          <SampleBadge text="SAMPLE SCRIPT" />
          <Body>{script.text}</Body>
        </Card>
      ) : null}
      <Segmented label="Subject glossary hint" value={useGlossary ? 'on' : 'off'} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} onChange={(v) => setUseGlossary(v === 'on')} />
      <Button label="Transcribe with Groq" busy={busy} disabled={!file} onPress={transcribe} />
      {error ? <Banner>{error}</Banner> : null}

      {tx && structure ? (
        <>
          <Card title="Transcript">
            <Row>
              <Stat label="API time" value={`${round(tx.latencyMs / 1000, 1)} s`} />
              <Stat label="Words" value={structure.words} />
              <Stat label="WER" value={wer ? `${(wer.wer * 100).toFixed(1)}%` : 'n/a'} />
              <Stat label="Language" value={tx.language || '?'} />
            </Row>
            <Body muted>
              Timestamps ordered: {structure.ordered ? 'yes' : 'NO'} · inside audio: {structure.withinAudio ? 'yes' : 'NO'} · zero-length words: {structure.zeroLength}
            </Body>
            <Body muted>Tap any word: playback should start right at it. Then mark the result.</Body>
            <View style={styles.words}>
              {tx.words.map((w, i) => (
                <Pressable key={i} onPress={() => seekTo(i)} accessibilityRole="button" accessibilityLabel={`Play from ${w.word}`}>
                  <Text style={[styles.word, i === playingIdx && styles.wordOn]}>{w.word}</Text>
                </Pressable>
              ))}
            </View>
            <Row>
              <View style={{ flex: 1 }}><Button kind="secondary" label="Started at the word" onPress={() => setSeekMarks((m) => [...m, true])} /></View>
              <View style={{ flex: 1 }}><Button kind="secondary" label="Started early/late" onPress={() => setSeekMarks((m) => [...m, false])} /></View>
            </Row>
            <Body muted>Seek checks: {seekMarks.length} · correct {seekPct === null ? '—' : `${Math.round(seekPct * 100)}%`}</Body>
          </Card>

          <Card title="Tap-along drift test">
            <Body muted>Audio plays from the start. Tap the big button the moment you hear the word shown. Your reaction time (about 0.2 s) is included; a steady result matters more than zero.</Body>
            {!drift || drift.at >= drift.targets.length ? (
              <Button label={drift ? 'Run again' : 'Start drift test'} onPress={startDrift} />
            ) : (
              <Pressable onPress={tapNow} style={styles.tap} accessibilityRole="button" accessibilityLabel="Tap when you hear the word">
                <Text style={styles.tapHint}>Tap when you hear</Text>
                <Text style={styles.tapWord}>{tx.words[drift.targets[drift.at] as number]?.word.trim()}</Text>
                <Text style={styles.tapHint}>{drift.at + 1} of {drift.targets.length}</Text>
              </Pressable>
            )}
            {d ? (
              <Row>
                <Stat label="Median offset" value={`${d.medianOffsetMs} ms`} />
                <Stat label="Spread (MAD)" value={`${d.madMs} ms`} />
                <Stat label="90% within" value={`${d.p90AbsMs} ms`} />
              </Row>
            ) : null}
          </Card>
          <Button label="Save result" onPress={save} />
          {saved ? <Body muted>{saved}</Body> : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  words: { flexDirection: 'row', flexWrap: 'wrap' },
  word: { fontSize: 17, lineHeight: 30, color: ui.ink, paddingHorizontal: 1 },
  wordOn: { backgroundColor: ui.soft, color: ui.accent },
  tap: { minHeight: 160, borderRadius: 16, backgroundColor: ui.accent, alignItems: 'center', justifyContent: 'center', gap: 6 },
  tapHint: { color: ui.paper, fontSize: 14 },
  tapWord: { color: ui.paper, fontSize: 32, fontWeight: '800' },
});
