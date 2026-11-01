/**
 * Hidden developer menu: the P0 spike lab, kept reachable until P6.
 * Unlocked by tapping the version number on the Me tab 7 times; otherwise
 * every /dev route redirects home (so a deep link can't open it either).
 */
import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import * as z from 'zod';

import { KEY_DEV_MENU, KV_APP, useStore } from '@/composition';
import { Spinner, ui } from '@/core/ui';

export default function DevLayout() {
  const store = useStore();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    store.kv.get(KV_APP, KEY_DEV_MENU, z.boolean()).then((v) => alive && setAllowed(v === true));
    return () => {
      alive = false;
    };
  }, [store]);

  if (allowed === null) return <Spinner />;
  if (!allowed) return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{
        headerTintColor: ui.accent,
        headerTitleStyle: { color: ui.ink, fontWeight: '700' },
        contentStyle: { backgroundColor: ui.canvas },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'P0 Spike Lab (developer)' }} />
      <Stack.Screen name="editor" options={{ title: 'Editor spike' }} />
      <Stack.Screen name="export" options={{ title: 'Export fidelity' }} />
      <Stack.Screen name="review" options={{ title: 'FSRS on this phone' }} />
      <Stack.Screen name="voice" options={{ title: '90-min recording' }} />
      <Stack.Screen name="timestamps" options={{ title: 'Audio timestamps' }} />
      <Stack.Screen name="ink" options={{ title: 'Ink latency' }} />
      <Stack.Screen name="results" options={{ title: 'Results log' }} />
      <Stack.Screen name="settings" options={{ title: 'AI key (Groq)' }} />
      <Stack.Screen name="typing" options={{ title: 'Typing diagnostics' }} />
    </Stack>
  );
}
