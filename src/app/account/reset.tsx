/** Password reset. The answer is the same whether or not an account exists (no account enumeration). */
import { Stack } from 'expo-router';
import { useState } from 'react';

import { useServices } from '@/composition';
import { userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, TextField } from '@/core/ui';

export default function Reset() {
  const { cloud } = useServices();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!cloud) return;
    setBusy(true);
    try {
      await cloud.auth.sendPasswordReset(email);
      setMsg('If there is an account for this email, a reset link is on its way.');
    } catch (e) {
      setMsg(userMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppScreen>
      <Stack.Screen options={{ title: 'Reset password' }} />
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" maxLength={254} />
      <AppButton label="Send reset link" busy={busy} disabled={!email} onPress={() => void send()} />
      {msg ? <BodyText>{msg}</BodyText> : null}
    </AppScreen>
  );
}
