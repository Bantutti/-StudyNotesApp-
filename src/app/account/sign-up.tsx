/** Create an account (email with verification, plan F1). */
import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { useServices } from '@/composition';
import { userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, Caption, ListRow, TextField } from '@/core/ui';

export default function SignUp() {
  const { cloud } = useServices();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!cloud) return <AppScreen><BodyText>Sync isn’t set up in this version of the app.</BodyText></AppScreen>;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await cloud.auth.signUpWithEmail(email, password);
      router.replace('/account/verify');
    } catch (e) {
      setError(userMessage(e));
      setBusy(false);
    }
  };

  return (
    <AppScreen>
      <Stack.Screen options={{ title: 'Create an account' }} />
      <BodyText muted>An account is only needed for sync. We’ll send a link to check your email.</BodyText>
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" maxLength={254} testID="signup-email" />
      <TextField label="Password (at least 8 characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" maxLength={128} testID="signup-password" />
      {error ? <BodyText>{error}</BodyText> : null}
      <AppButton label="Create account" busy={busy} disabled={!email || password.length < 8} onPress={() => void submit()} testID="signup-submit" />
      <Caption>By creating an account you agree to the Terms of Use and the Privacy Policy.</Caption>
      <ListRow icon="document-text-outline" title="Terms of Use" onPress={() => router.push('/legal/terms')} />
      <ListRow icon="shield-checkmark-outline" title="Privacy Policy" onPress={() => router.push('/legal/privacy')} />
      <ListRow icon="log-in-outline" title="I already have an account" onPress={() => router.replace('/account/sign-in')} />
    </AppScreen>
  );
}
