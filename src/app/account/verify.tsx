/**
 * Waiting for the email link. The rules refuse sync until the email is
 * verified, so this screen checks again (reload + fresh token) on demand
 * and whenever the app comes back to the front (after the person tapped
 * the link in their mail app).
 */
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useServices, useSyncView } from '@/composition';
import { userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, Caption } from '@/core/ui';

export default function Verify() {
  const { cloud } = useServices();
  const view = useSyncView();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (!cloud) return;
    setBusy(true);
    setMsg(null);
    try {
      const s = await cloud.auth.checkVerified();
      if (s.status === 'ready') router.replace('/sync/turn-on');
      else setMsg('Not verified yet. Open the link in the email, then come back.');
    } catch (e) {
      setMsg(userMessage(e));
    } finally {
      setBusy(false);
    }
  }, [cloud]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => sub.remove();
  }, [check]);

  const email = view.kind === 'unverified' ? view.email : null;
  return (
    <AppScreen>
      <Stack.Screen options={{ title: 'Check your email' }} />
      <BodyText>We sent a link to {email ?? 'your email address'}. Open it to confirm the address, then come back here.</BodyText>
      <AppButton label="I opened the link" busy={busy} onPress={() => void check()} testID="verify-check" />
      <AppButton label="Send the email again" kind="secondary" onPress={() => void cloud?.auth.resendVerification().then(() => setMsg('Sent. Check your inbox and spam folder.'), (e: unknown) => setMsg(userMessage(e)))} />
      <AppButton label="Use another account" kind="plain" onPress={() => void cloud?.sync.signOut().then(() => router.replace('/account/sign-in'))} />
      {msg ? <BodyText>{msg}</BodyText> : null}
      <Caption>Testing with the emulator? Run “npm run emu:verify -- your@email” on the computer (TESTING_ON_DEVICE.md).</Caption>
    </AppScreen>
  );
}
