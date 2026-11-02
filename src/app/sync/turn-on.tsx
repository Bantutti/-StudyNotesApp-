/**
 * "Turn on sync" (plan Flow 8, §17 "confirmation screen with counts"):
 * shows exactly what will upload to which account, then a progress view.
 */
import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { countsText, maskEmail, useServices, useSyncView } from '@/composition';
import { userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, Caption, ListRow, Title } from '@/core/ui';
import type { SyncProgress } from '@/modules/sync';

export default function TurnOnSync() {
  const { cloud } = useServices();
  const view = useSyncView();
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!cloud) return <AppScreen><BodyText>Sync isn’t set up in this version of the app.</BodyText></AppScreen>;
  if (view.kind === 'on' && !busy) {
    return (
      <AppScreen>
        <Stack.Screen options={{ title: 'Sync is on' }} />
        <Title>Sync is on</Title>
        <BodyText>Your notes are backed up and stay the same on every device where you sign in.</BodyText>
        <AppButton label="Done" onPress={() => router.replace('/(tabs)/me')} testID="turnon-done" />
      </AppScreen>
    );
  }
  if (view.kind === 'otherAccount') {
    return (
      <AppScreen>
        <Stack.Screen options={{ title: 'Another account' }} />
        <BodyText>The notes on this phone belong to a different account. To use this account here, first remove the notes from this phone (Me, Delete all data), or sign in with the other account.</BodyText>
        <AppButton label="Back" onPress={() => router.back()} />
      </AppScreen>
    );
  }
  if (view.kind !== 'readyToTurnOn' && !busy) {
    return (
      <AppScreen>
        <BodyText>Sign in first, with an email address you have confirmed.</BodyText>
        <AppButton label="Sign in" onPress={() => router.replace('/account/sign-in')} />
      </AppScreen>
    );
  }

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await cloud.sync.turnOn({ onProgress: setProgress });
      if (r.status.phase === 'offline') setError('You went offline. Your notes will upload when you are back online.');
      else if (r.status.phase !== 'idle') setError('Some items could not sync. See Me, Sync.');
      else router.replace('/(tabs)/me');
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const counts = view.kind === 'readyToTurnOn' ? view.counts : {};
  const email = view.kind === 'readyToTurnOn' ? view.email : null;
  return (
    <AppScreen>
      <Stack.Screen options={{ title: 'Turn on sync' }} />
      <Title>Upload your notes?</Title>
      <BodyText>Upload {countsText(counts)} from this phone to {maskEmail(email)}?</BodyText>
      <Caption>Your notes stay on this phone too. Version history and your AI key never leave this phone.</Caption>
      {progress ? (
        <BodyText>
          {progress.step === 'upload' ? `Uploading ${progress.done} of ${progress.total}…` : progress.step === 'done' ? 'Done.' : 'Getting notes from your other devices…'}
        </BodyText>
      ) : null}
      {error ? <BodyText>{error}</BodyText> : null}
      <AppButton label="Turn on sync" busy={busy} onPress={() => void start()} testID="turnon-confirm" />
      <ListRow icon="shield-checkmark-outline" title="Privacy Policy" onPress={() => router.push('/legal/privacy')} />
    </AppScreen>
  );
}
