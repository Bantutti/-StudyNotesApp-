/**
 * Root layout: services, theme, app data (database), then the navigator.
 * Routes: / (decides onboarding or tabs), (tabs), onboarding, subject/[id],
 * inbox, note/[id], new (sheet), dev (hidden developer menu).
 * P2b: account/*, sync/*, settings/app-lock, legal/[doc]; SyncBridge and the
 * app lock gate sit inside the data provider.
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AiWiring, AppDataProvider, AppLockGate, CustomPackLoader, ServicesProvider, SyncBridge, useServices } from '@/composition';
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
        <Stack.Screen name="font-licenses" options={{ title: 'Font licences' }} />
        <Stack.Screen name="match" options={{ presentation: 'modal', title: 'Match a look' }} />
        <Stack.Screen name="looks" options={{ title: 'Your looks' }} />
        <Stack.Screen name="dev" options={{ headerShown: false }} />
        <Stack.Screen name="ai/settings" options={{ title: 'AI' }} />
        {/* P2b: account, sync, app lock and legal pages */}
        <Stack.Screen name="account/sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="account/sign-up" options={{ title: 'Create an account' }} />
        <Stack.Screen name="account/verify" options={{ title: 'Check your email' }} />
        <Stack.Screen name="account/reset" options={{ title: 'Reset password' }} />
        <Stack.Screen name="account/delete" options={{ title: 'Delete account' }} />
        <Stack.Screen name="sync/turn-on" options={{ title: 'Turn on sync' }} />
        <Stack.Screen name="sync/attention" options={{ title: 'Needs attention' }} />
        <Stack.Screen name="sync/conflict" options={{ title: 'Choose what to keep' }} />
        <Stack.Screen name="settings/app-lock" options={{ title: 'App lock' }} />
        <Stack.Screen name="legal/[doc]" options={{ title: '' }} />
      </Stack>
      <AiWiring />
    </>
  );
}

function WithData() {
  const { appData } = useServices();
  return (
    <AppDataProvider deps={appData}>
      <SyncBridge />
      <CustomPackLoader />
      <AppLockGate>
        <Navigator />
      </AppLockGate>
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
