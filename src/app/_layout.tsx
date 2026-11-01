/**
 * Root layout: services, theme, app data (database), then the navigator.
 * Routes: / (decides onboarding or tabs), (tabs), onboarding, subject/[id],
 * inbox, note/[id], new (sheet), dev (hidden developer menu).
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppDataProvider, ServicesProvider, useServices } from '@/composition';
import { ThemeProvider, useTheme } from '@/core/ui';

function Navigator() {
  const th = useTheme();
  return (
    <>
      <StatusBar style={th.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerTintColor: th.accentText,
          headerTitleStyle: { color: th.text },
          headerStyle: { backgroundColor: th.bg },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: th.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="new" options={{ presentation: 'formSheet', title: 'New', sheetAllowedDetents: [0.4, 0.7] }} />
        <Stack.Screen name="subject/[id]" options={{ title: '' }} />
        <Stack.Screen name="folder/[id]" options={{ title: '' }} />
        <Stack.Screen name="inbox" options={{ title: 'Inbox' }} />
        <Stack.Screen name="note/[id]" options={{ title: '' }} />
        <Stack.Screen name="search" options={{ title: 'Search' }} />
        <Stack.Screen name="subject-form" options={{ presentation: 'modal', title: '' }} />
        <Stack.Screen name="folder-form" options={{ presentation: 'modal', title: '' }} />
        <Stack.Screen name="note-actions" options={{ presentation: 'formSheet', title: '', sheetAllowedDetents: [0.5, 0.9] }} />
        <Stack.Screen name="templates" options={{ presentation: 'modal', title: '' }} />
        <Stack.Screen name="history/[id]" options={{ title: 'History' }} />
        <Stack.Screen name="version/[id]" options={{ title: 'Version' }} />
        <Stack.Screen name="style/[id]" options={{ presentation: 'formSheet', title: 'Style', sheetAllowedDetents: [0.6, 0.95] }} />
        <Stack.Screen name="dev" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

function WithData() {
  const { appData } = useServices();
  return (
    <AppDataProvider deps={appData}>
      <Navigator />
    </AppDataProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ServicesProvider>
          <WithData />
        </ServicesProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
