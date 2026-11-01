import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { useServices } from '@/composition';
import { resultsToMarkdown, type SpikeResult } from '@/core';
import { Body, Button, Card, Row, Screen, Verdict } from '@/core/ui';

export default function Results() {
  const { results } = useServices();
  const [all, setAll] = useState<SpikeResult[]>([]);
  const [msg, setMsg] = useState('');

  useFocusEffect(
    useCallback(() => {
      results.list().then((r) => setAll(r.reverse()));
    }, [results]),
  );

  const copy = async () => {
    await Clipboard.setStringAsync(resultsToMarkdown([...all].reverse()));
    setMsg('Copied. Paste it into the chat so the results can be reviewed.');
  };

  const clear = () =>
    Alert.alert('Clear all results?', 'This deletes the results log on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { await results.clear(); setAll([]); } },
    ]);

  return (
    <Screen>
      <Body muted>Results hold measurements only: no note text, transcripts, file names or keys.</Body>
      <Row>
        <Button label="Copy all as Markdown" disabled={all.length === 0} onPress={copy} />
        <Button kind="danger" label="Clear" disabled={all.length === 0} onPress={clear} />
      </Row>
      {msg ? <Body muted>{msg}</Body> : null}
      {all.length === 0 ? <Body>No results yet. Run a spike and tap Save result.</Body> : null}
      {all.map((r) => (
        <Card key={r.id} title={`${r.spike} · ${new Date(r.at).toLocaleString()}`}>
          <Verdict verdict={r.verdict} />
          <Body>{r.summary}</Body>
          <Body muted>{r.device.model} · {r.device.os} {r.device.osVersion} · {r.device.runtime}</Body>
        </Card>
      ))}
    </Screen>
  );
}
