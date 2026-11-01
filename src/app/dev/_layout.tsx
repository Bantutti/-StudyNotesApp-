/**
 * Hidden developer menu: the P0 spike lab, kept reachable until P6.
 * Unlocked by tapping the version number on the Me tab 7 times, and only in
 * dev mode or a development build (devToolsAllowed). Otherwise every /dev
 * route redirects home, so a deep link (notedpo://dev/settings) can't open it
 * either, even if an older build stored the unlock.
 */
import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { devMenuUnlocked, useServices, useStore } from '@/composition';
import { Spinner, ui } from '@/core/ui';

export default function DevLayout() {
  const store = useStore();
  const { devTools } = useServices();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    devMenuUnlocked(store, devTools).then((v) => alive && setAllowed(v));
    return () => {
      alive = false;
    };
  }, [store, devTools]);

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
