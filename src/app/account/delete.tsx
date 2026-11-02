/**
 * Delete account (both stores; P2a ACCOUNT_DELETION §A.2.1).
 * 1. Confirm (exact wording from §A.2.1). 2. Sign in again (password, or
 * Google/Apple). 3. Progress by step and count; no Cancel once started.
 * 4. Done: offer "Delete the notes on this phone too".
 */
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { useAppData, useServices, useSyncView } from '@/composition';
import { userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, Caption, TextField, Title } from '@/core/ui';
import { deleteAccountAndCloudData, type AuthError, type DeletionProgress } from '@/modules/auth';

const STEP: Record<DeletionProgress['step'], string> = {
  mark: 'Stopping uploads from your other devices…',
  storage: 'Deleting your files…',
  firestore: 'Deleting your synced notes…',
  profile: 'Deleting your profile…',
  auth: 'Deleting your account…',
};

export default function DeleteAccount() {
  const { cloud, logger } = useServices();
  const { store, resetAll } = useAppData();
  const view = useSyncView();
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm');
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [appleHint, setAppleHint] = useState(false);
  if (!cloud) return <AppScreen><BodyText>Sync isn’t set up in this version of the app.</BodyText></AppScreen>;
  const st = cloud.auth.state();
  const provider = 'provider' in st ? st.provider : 'password';

  const run = async () => {
    setError(null);
    try {
      const { appleAuthorizationCode } = await cloud.auth.reauthenticate(
        provider === 'google.com' ? { method: 'google' } : provider === 'apple.com' ? { method: 'apple' } : { method: 'password', password },
      );
      setPhase('running');
      const r = await deleteAccountAndCloudData(
        { auth: cloud.firebase.auth, firestore: cloud.firebase.firestore, storage: cloud.firebase.storage, logger, stopSync: () => cloud.sync.stopForDeletion() },
        store,
        { appleAuthorizationCode, onProgress: (p) => setProgress(`${STEP[p.step]}${p.deleted ? ` (${p.deleted})` : ''}`) },
      );
      setAppleHint(r.appleRevoke === 'failed' || r.appleRevoke === 'no_code');
      await cloud.sync.afterAccountDeleted();
      setPhase('done');
    } catch (e) {
      setPhase('confirm');
      setError((e as AuthError).reason === 'reauth_required' ? (e as Error).message : userMessage(e));
    }
  };

  if (phase === 'done') {
    return (
      <AppScreen>
        <Stack.Screen options={{ title: 'Account deleted', headerBackVisible: false }} />
        <Title>Your account is deleted</Title>
        <BodyText>Your account and everything synced to it have been deleted. The notes on this phone are still here.</BodyText>
        {appleHint ? <BodyText>To finish, remove NotedPo from “Sign in with Apple” in your Apple ID settings.</BodyText> : null}
        <AppButton
          label="Delete local data too"
          kind="danger"
          onPress={() =>
            Alert.alert('Delete local data', 'Delete every note, subject and file on this phone? This can\u2019t be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => void resetAll().then(() => router.replace('/')) },
            ])
          }
          testID="delete-local-too"
        />
        <AppButton label="Keep my notes on this phone" kind="secondary" onPress={() => router.replace('/(tabs)/me')} />
      </AppScreen>
    );
  }
  return (
    <AppScreen>
      <Stack.Screen options={{ title: 'Delete account', headerBackVisible: phase !== 'running' }} />
      <Title>Delete your account?</Title>
      <BodyText>
        Delete your account and all synced notes, cards, recordings and files? This can’t be undone. Notes on this device stay unless you also choose Delete local data.
      </BodyText>
      {view.kind !== 'on' && view.kind !== 'readyToTurnOn' ? <BodyText muted>Sign in to the account you want to delete first.</BodyText> : null}
      {provider === 'password' ? (
        <TextField label="Your password (to confirm it’s you)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" maxLength={128} testID="delete-password" />
      ) : (
        <Caption>You’ll be asked to sign in with {provider === 'apple.com' ? 'Apple' : 'Google'} again.</Caption>
      )}
      {phase === 'running' ? <BodyText>{progress || 'Starting…'}</BodyText> : null}
      {error ? <BodyText>{error}</BodyText> : null}
      <AppButton label="Delete my account" kind="danger" busy={phase === 'running'} disabled={provider === 'password' && !password} onPress={() => void run()} testID="delete-confirm" />
      {phase === 'confirm' ? <AppButton label="Cancel" kind="plain" onPress={() => router.back()} /> : null}
    </AppScreen>
  );
}
