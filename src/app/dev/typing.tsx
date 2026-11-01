/**
 * Developer menu > Typing diagnostics.
 * Type in the editor below with each keyboard (Gboard, Samsung, SwiftKey,
 * iOS) and copy the log. It records event METADATA only: event types, input
 * types, lengths, composition flags and cursor offsets. Never the text.
 * This turns Rey's phone test into data for tuning the editor input.
 */
import * as Clipboard from 'expo-clipboard';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useServices } from '@/composition';
import { getDeviceInfo, type NoteDoc } from '@/core';
import { Body, Button, Row, ui } from '@/core/ui';
import { EditorView, type DiagEvent, type EditorHandle } from '@/modules/editor';

const START: NoteDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Type here. Try: a long word, autocorrect, Enter at the start of a line, a list "- ", and voice typing.' }] }] };

function summarize(events: DiagEvent[]): string {
  const count = (k: DiagEvent['kind']) => events.filter((e) => e.kind === k).length;
  return `events ${events.length} · compositions ${count('compositionstart')} · keydown 229: ${events.filter((e) => e.keyCode === 229).length}`;
}

export default function TypingDiagnostics() {
  const { logger, packs } = useServices();
  const editor = useRef<EditorHandle>(null);
  const [events, setEvents] = useState<DiagEvent[]>([]);
  const [msg, setMsg] = useState('');

  const copy = async () => {
    const d = getDeviceInfo();
    const header = `# Typing diagnostics\nDevice: ${d.model}, ${d.os} ${d.osVersion}, ${d.runtime}\nKeyboard: (write which keyboard you used)\n\n`;
    const lines = events.map((e) =>
      [e.t, e.kind, e.inputType ?? '', e.key ?? '', e.keyCode ?? '', e.len ?? '', e.composing === undefined ? '' : e.composing ? 'C' : '-', `${e.offset ?? ''}/${e.size ?? ''}`].join('\t'),
    );
    await Clipboard.setStringAsync(header + 't\tkind\tinputType\tkey\tkeyCode\tlen\tcomposing\toffset/size\n' + lines.join('\n'));
    setMsg('Copied. Paste it into your report (it contains no note text).');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <View style={styles.top}>
        <Body muted>Records keyboard events only (types, lengths, flags), never what you type.</Body>
        <Text style={styles.stat}>{summarize(events)}</Text>
      </View>
      <View style={styles.editor}>
        <EditorView
          ref={editor}
          logger={logger}
          onReady={() => {
            editor.current?.load(START);
            editor.current?.setPack(packs.getOrDefault('pastel-highlight'));
            editor.current?.setDiagnostics(true);
          }}
          onDiag={(batch) => setEvents((prev) => [...prev, ...batch].slice(-1_000))}
        />
      </View>
      <View style={styles.bottom}>
        <Row>
          <View style={styles.flex}>
            <Button label="Copy log" onPress={copy} disabled={!events.length} />
          </View>
          <View style={styles.flex}>
            <Button kind="secondary" label="Clear" onPress={() => setEvents([])} />
          </View>
        </Row>
        {msg ? <Body muted>{msg}</Body> : null}
        {events.slice(-6).map((e, i) => (
          <Text key={`${e.t}-${i}`} style={styles.line} numberOfLines={1}>
            {e.t} {e.kind} {e.inputType ?? ''} {e.key ?? ''} {e.keyCode ?? ''} {e.composing ? 'composing' : ''}
          </Text>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.canvas },
  top: { padding: 12, gap: 4 },
  stat: { color: ui.ink, fontWeight: '700' },
  editor: { flex: 1, marginHorizontal: 12, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: ui.line },
  bottom: { padding: 12, gap: 6 },
  flex: { flex: 1 },
  line: { fontFamily: 'monospace', fontSize: 11, color: ui.muted },
});
