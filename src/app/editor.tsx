import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePackFaces, useServices } from '@/composition';
import { countBlocks, makeLongSample, median, round } from '@/core';
import { Body, Button, Row, SampleBadge, Segmented, Stat, ui } from '@/core/ui';
import { EditorView, EDITOR_SCRIPT_BYTES, type EditorCommand, type EditorHandle } from '@/modules/editor';
import { highlighterColor, P0_PACK_IDS } from '@/modules/stylepacks';

type Metrics = { boot?: number; load?: number; pack?: number; fonts?: number; pingP50?: number };

export default function EditorSpike() {
  const { notes, logger, results, packs } = useServices();
  const editor = useRef<EditorHandle>(null);
  const [packId, setPackId] = useState<string>(P0_PACK_IDS[0]);
  const { pack, faces } = usePackFaces(packId);
  const [ready, setReady] = useState(false);
  const [m, setM] = useState<Metrics>({});
  const [blocks, setBlocks] = useState(countBlocks(notes.get().doc));
  const [term, setTerm] = useState('Osmosis');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const isSample = notes.get().isSample;

  // Push pack and fonts whenever the editor is ready or they change.
  useEffect(() => {
    if (ready) editor.current?.setPack(pack);
  }, [ready, pack]);
  useEffect(() => {
    if (ready && faces) editor.current?.setFonts(faces);
  }, [ready, faces]);

  const onReady = () => {
    setReady(true);
    editor.current?.load(notes.get().doc);
  };

  const cmd = (name: EditorCommand, arg?: string) => editor.current?.command(name, arg);

  const measurePing = async () => {
    setBusy(true);
    try {
      const rtts: number[] = [];
      for (let i = 0; i < 7; i++) rtts.push(await (editor.current as EditorHandle).ping());
      setM((x) => ({ ...x, pingP50: round(median(rtts), 1) }));
    } finally {
      setBusy(false);
    }
  };

  // The WebView reports load_ms for the long note (25x the sample, ~400 blocks).
  const loadLong = () => editor.current?.load(makeLongSample(25));

  const save = async () => {
    const pass = (m.boot ?? 9999) < 1500 && (m.load ?? 9999) < 500 && (m.pingP50 ?? 9999) < 50;
    await results.record({
      spike: 'editor',
      verdict: m.boot === undefined || m.pingP50 === undefined ? 'info' : pass ? 'pass' : 'fail',
      summary: `Editor boot ${round(m.boot ?? NaN, 0)} ms, load ${round(m.load ?? NaN, 0)} ms, bridge p50 ${m.pingP50 ?? 'n/a'} ms`,
      metrics: {
        boot_ms: round(m.boot ?? -1, 1),
        load_ms: round(m.load ?? -1, 1),
        set_pack_ms: round(m.pack ?? -1, 1),
        set_fonts_ms: round(m.fonts ?? -1, 1),
        bridge_rtt_p50_ms: m.pingP50 ?? -1,
        blocks,
        script_kb: Math.round(EDITOR_SCRIPT_BYTES / 1024),
        pack: pack.id,
        fonts_loaded: faces?.length ?? 0,
      },
    });
    setSaved('Saved to the results log.');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <View style={styles.top}>
        {isSample ? <SampleBadge text="SAMPLE NOTE" /> : null}
        <Segmented
          label="Style pack"
          value={packId}
          options={P0_PACK_IDS.map((id) => ({ value: id, label: packs.get(id)?.name ?? id }))}
          onChange={setPackId}
        />
        <View style={styles.toolbar}>
          {(
            [
              ['B', 'bold'], ['I', 'italic'], ['U', 'underline'], ['H1', 'h1'], ['H2', 'h2'],
              ['•', 'bulletList'], ['1.', 'orderedList'], ['Callout', 'callout'], ['—', 'hr'],
              ['Undo', 'undo'], ['Redo', 'redo'],
            ] as const
          ).map(([label, name]) => (
            <Tool key={name} label={label} onPress={() => cmd(name)} />
          ))}
          {pack.highlighters.slice(0, 4).map((h, i) => (
            <Pressable
              key={h.id}
              accessibilityRole="button"
              accessibilityLabel={`Highlight: ${h.meaning || h.id}`}
              onPress={() => cmd('highlight', `k${i}`)}
              style={[styles.swatch, { backgroundColor: highlighterColor(pack, i) }]}
            />
          ))}
          <Tool label="No hl" onPress={() => cmd('unhighlight')} />
        </View>
        <View style={styles.defRow}>
          <TextInput
            value={term}
            onChangeText={(t) => setTerm(t.slice(0, 200))}
            placeholder="Definition term"
            style={styles.input}
            accessibilityLabel="Definition term"
            maxLength={200}
          />
          <Tool label="Wrap as definition" onPress={() => cmd('definition', term)} />
        </View>
      </View>
      <View style={styles.editor}>
        <EditorView
          ref={editor}
          logger={logger}
          onReady={onReady}
          onChange={(doc) => {
            notes.set(doc);
            setBlocks(countBlocks(doc));
          }}
          onMetric={(name, ms) =>
            setM((x) => ({
              ...x,
              ...(name === 'boot_ms' ? { boot: ms } : name === 'load_ms' ? { load: ms } : name === 'set_pack_ms' ? { pack: ms } : { fonts: ms }),
            }))
          }
        />
      </View>
      <View style={styles.bottom}>
        <Row>
          <Stat label="Boot" value={m.boot === undefined ? '…' : `${round(m.boot, 0)} ms`} />
          <Stat label="Load" value={m.load === undefined ? '…' : `${round(m.load, 0)} ms`} />
          <Stat label="Bridge p50" value={m.pingP50 === undefined ? '—' : `${m.pingP50} ms`} />
          <Stat label="Blocks" value={blocks} />
        </Row>
        <Row>
          <View style={styles.flex}><Button kind="secondary" label="Measure bridge" busy={busy} disabled={!ready} onPress={measurePing} /></View>
          <View style={styles.flex}><Button kind="secondary" label="Load long note" disabled={!ready} onPress={loadLong} /></View>
          <View style={styles.flex}><Button label="Save result" disabled={!ready} onPress={save} /></View>
        </Row>
        {saved ? <Body muted>{saved}</Body> : null}
      </View>
    </SafeAreaView>
  );
}

function Tool({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.tool}>
      <Text style={styles.toolText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.canvas },
  top: { padding: 12, gap: 8 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  tool: { minHeight: 40, minWidth: 40, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.paper, alignItems: 'center', justifyContent: 'center' },
  toolText: { color: ui.ink, fontWeight: '700' },
  swatch: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, borderColor: ui.line },
  defRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  input: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: ui.line, borderRadius: 8, paddingHorizontal: 10, backgroundColor: ui.paper, color: ui.ink },
  editor: { flex: 1, marginHorizontal: 12, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: ui.line },
  bottom: { padding: 12, gap: 8 },
  flex: { flex: 1 },
});
