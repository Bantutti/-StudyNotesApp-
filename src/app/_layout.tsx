import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ServicesProvider } from '@/composition';
import { ui } from '@/core/ui';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ServicesProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerTintColor: ui.accent,
            headerTitleStyle: { color: ui.ink, fontWeight: '700' },
            contentStyle: { backgroundColor: ui.canvas },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'P0 Spike Lab' }} />
          <Stack.Screen name="editor" options={{ title: 'Editor spike' }} />
          <Stack.Screen name="export" options={{ title: 'Export fidelity' }} />
          <Stack.Screen name="review" options={{ title: 'FSRS on this phone' }} />
          <Stack.Screen name="voice" options={{ title: '90-min recording' }} />
          <Stack.Screen name="timestamps" options={{ title: 'Audio timestamps' }} />
          <Stack.Screen name="ink" options={{ title: 'Ink latency' }} />
          <Stack.Screen name="results" options={{ title: 'Results log' }} />
          <Stack.Screen name="settings" options={{ title: 'AI key (Groq)' }} />
        </Stack>
      </ServicesProvider>
    </GestureHandlerRootView>
  );
}
