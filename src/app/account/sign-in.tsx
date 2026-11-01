/** Sign in to turn on sync (plan Flow 8). Email always; Google/Apple only in builds that have them (Q1). */
import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { useServices } from '@/composition';
import { userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, ListRow, TextField } from '@/core/ui';

export default function SignIn() {
  const { cloud } = useServices();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!cloud) return <AppScreen><BodyText>Sync isn’t set up in this version of the app.</BodyText></AppScreen>;
  const methods = cloud.auth.methods();

  const run = async (fn: () => Promise<{ status: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const s = await fn();
      router.replace(s.status === 'unverified' ? '/account/verify' : '/sync/turn-on');
    } catch (e) {
      setError(userMessage(e));
      setBusy(false);
    }
  };

  return (
    <AppScreen>
      <Stack.Screen options={{ title: 'Sign in' }} />
      <BodyText muted>Sign in to keep your notes in sync on your phones and tablets. We only use your email address.</BodyText>
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" maxLength={254} testID="signin-email" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" maxLength={128} testID="signin-password" />
      {error ? <BodyText>{error}</BodyText> : null}
      <AppButton label="Sign in" busy={busy} disabled={!email || !password} onPress={() => void run(() => cloud.auth.signInWithEmail(email, password))} testID="signin-submit" />
      {methods.google ? <AppButton label="Continue with Google" kind="secondary" onPress={() => void run(() => cloud.auth.signInWithGoogle())} /> : null}
      {methods.apple ? <AppButton label="Continue with Apple" kind="secondary" onPress={() => void run(() => cloud.auth.signInWithApple())} /> : null}
      <ListRow icon="person-add-outline" title="Create an account" onPress={() => router.replace('/account/sign-up')} testID="signin-to-signup" />
      <ListRow icon="key-outline" title="Forgot password" onPress={() => router.push('/account/reset')} />
    </AppScreen>
  );
}
