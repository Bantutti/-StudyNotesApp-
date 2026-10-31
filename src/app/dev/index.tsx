import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { useServices } from '@/composition';
import { getDeviceInfo, type SpikeId, type SpikeResult } from '@/core';
import { Banner, Body, Button, Card, Row, Screen, Verdict } from '@/core/ui';

const SPIKE_CARDS: { id: SpikeId; route: Href; title: string; what: string; needs: string }[] = [
  { id: 'editor', route: '/dev/editor', title: '1. Editor (TipTap in WebView)', what: 'Load time, pack switching, bridge round-trip.', needs: 'Expo Go' },
  { id: 'export', route: '/dev/export', title: '2. Export fidelity', what: 'Sample note to PDF, DOCX and print with pack fonts.', needs: 'Expo Go' },
  { id: 'review', route: '/dev/review', title: '3. FSRS on Hermes', what: 'Scheduler matches Node golden values; logs merge.', needs: 'Expo Go' },
  { id: 'voice', route: '/dev/voice', title: '4. 90-minute background recording', what: 'Recording survives screen lock; size and battery.', needs: 'Dev build (Android)' },
  { id: 'timestamps', route: '/dev/timestamps', title: '5. Audio timestamps (Groq Whisper)', what: 'Word timestamps, accuracy (WER), tap-to-seek drift.', needs: 'Expo Go + Groq key' },
  { id: 'ink', route: '/dev/ink', title: '6. Ink latency', what: 'Frame smoothness, sample rate, palm rejection.', needs: 'Expo Go (tablet ideal)' },
];

export default function Home() {
  const { results } = useServices();
  const router = useRouter();
  const [latest, setLatest] = useState<Partial<Record<SpikeId, SpikeResult>>>({});
  const device = getDeviceInfo();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      results.list().then((all) => {
        if (!alive) return;
        const map: Partial<Record<SpikeId, SpikeResult>> = {};
        for (const r of all) map[r.spike] = r;
        setLatest(map);
      });
      return () => {
        alive = false;
      };
    }, [results]),
  );

  return (
    <Screen>
      <Banner tone="info">
        P0 prototype: a test lab, not the app. It uses a built-in SAMPLE note and sample reading scripts. No
        account, no sync, nothing leaves the phone unless you tap Transcribe.
      </Banner>
      <Body muted>
        Running on {device.model} ({device.os} {device.osVersion}) in {device.runtime}
        {device.isTablet ? ', tablet' : ''}.
      </Body>
      {SPIKE_CARDS.map((s) => {
        const r = latest[s.id];
        return (
          <Card key={s.id} title={s.title}>
            <Body>{s.what}</Body>
            <Row>
              <Verdict verdict={r ? r.verdict : 'untested'} />
              <Text style={{ color: '#5E6375' }}>Needs: {s.needs}</Text>
            </Row>
            <Button label="Open" onPress={() => router.push(s.route)} />
          </Card>
        );
      })}
      <Row>
        <View style={{ flex: 1 }}>
          <Button kind="secondary" label="Results log" onPress={() => router.push('/dev/results')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button kind="secondary" label="AI key" onPress={() => router.push('/dev/settings')} />
        </View>
      </Row>
    </Screen>
  );
}
