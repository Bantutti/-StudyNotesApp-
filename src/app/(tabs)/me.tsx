/**
 * Me (P1 subset): default look, Delete all data, About and font licences,
 * and the hidden developer menu (tap the version 7 times; only in dev mode
 * or a development build, see devToolsAllowed). P2b: account and sync,
 * app lock, and the in-app privacy, terms and account-deletion pages.
 */
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { createTapUnlock, devMenuUnlocked, KEY_DEV_MENU, KV_APP, maskEmail, useAppData, useServices, useCloudSyncView, type SyncView } from '@/composition';
import { t, userMessage } from '@/core';
import { AppScreen, BodyText, Caption, ListRow, SectionHeader, Surface } from '@/core/ui';
import { DEFAULT_PACK_ID } from '@/modules/stylepacks';

/** One line about sync for the Me screen (P2b). */
function syncSubtitle(v: SyncView): string {
  switch (v.kind) {
    case 'on':
      return v.status.phase === 'offline' ? 'Offline. Changes upload when you are back online.' : v.status.pending ? `Syncing (${v.status.pending} to upload)` : 'Synced';
    case 'readyToTurnOn':
      return 'Signed in. Sync is off.';
    case 'unverified':
      return 'Confirm your email to turn on sync.';
    case 'otherAccount':
      return 'This phone holds another account\u2019s notes.';
    default:
      return 'Back up your notes and use them on your other devices.';
  }
}

export default function Me() {
  const { store, resetAll } = useAppData();
  const { packs, devTools, cloud } = useServices();
  const syncView = useCloudSyncView(cloud);
  const [devMenu, setDevMenu] = useState(false);
  const [packId, setPackId] = useState<string>(DEFAULT_PACK_ID);
  const unlock = useMemo(() => createTapUnlock({ enabled: devTools }), [devTools]);
  const version = Constants.expoConfig?.version ?? '0.0.0';

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.all([devMenuUnlocked(store, devTools), store.settings.get()]).then(([dev, settings]) => {
        if (!alive) return;
        setDevMenu(dev);
        setPackId(settings.defaultPack ?? DEFAULT_PACK_ID);
      });
      return () => {
        alive = false;
      };
    }, [store, devTools]),
  );

  const tapVersion = async () => {
    if (devMenu || !devTools) return; // preview and store builds: the version row is just text
    const left = unlock.tap();
    if (left === 0) {
      await store.kv.set(KV_APP, KEY_DEV_MENU, true);
      setDevMenu(true);
      Alert.alert('Developer menu on', 'The P0 test screens are now under Me.');
    }
  };

  const confirmDeleteAll = () =>
    Alert.alert(t('me.deleteAll'), t('me.deleteAllAsk'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            if (cloud) await cloud.sync.signOut().catch(() => undefined); // a shared phone: sign out too
            await resetAll();
            router.replace('/');
          } catch (e) {
            Alert.alert(t('me.deleteAll'), userMessage(e));
          }
        },
      },
    ]);

  return (
    <AppScreen>
      <SectionHeader>Look</SectionHeader>
      <ListRow
        icon="color-palette-outline"
        title="Default look for new notes"
        trailing={packs.getOrDefault(packId).name}
        onPress={() => router.push('/onboarding/look?from=settings')}
        testID="me-default-look"
      />

      {/* P2b: account and sync */}
      <SectionHeader>Account and sync</SectionHeader>
      {syncView.kind === 'off' ? (
        <Surface>
          <BodyText muted>Your notes are saved on this phone only. Sync isn’t set up in this version of the app.</BodyText>
        </Surface>
      ) : syncView.kind === 'signedOut' || syncView.kind === 'loading' || syncView.kind === 'accountGone' ? (
        <>
          {syncView.kind === 'accountGone' ? (
            <Surface>
              <BodyText>Your account was deleted on another device. Your notes are still on this phone.</BodyText>
            </Surface>
          ) : null}
          <ListRow icon="cloud-upload-outline" title="Turn on sync" subtitle={syncSubtitle(syncView)} onPress={() => { cloud?.sync.dismissAccountGone(); router.push('/account/sign-in'); }} testID="me-turn-on-sync" />
        </>
      ) : (
        <>
          <ListRow
            icon={syncView.kind === 'on' ? 'cloud-done-outline' : 'cloud-outline'}
            title={maskEmail('email' in syncView ? syncView.email : null)}
            subtitle={syncSubtitle(syncView)}
            onPress={() => router.push(syncView.kind === 'unverified' ? '/account/verify' : syncView.kind === 'on' ? '/sync/attention' : '/sync/turn-on')}
            testID="me-sync"
          />
          {syncView.kind === 'on' ? <ListRow icon="sync-outline" title="Sync now" onPress={() => void cloud?.sync.syncNow()} testID="me-sync-now" /> : null}
          {syncView.kind === 'on' ? <ListRow icon="pause-outline" title="Turn off sync on this phone" onPress={() => void cloud?.sync.pause()} /> : null}
          <ListRow icon="log-out-outline" title="Sign out" subtitle="Your notes stay on this phone" onPress={() => void cloud?.sync.signOut()} testID="me-sign-out" />
          <ListRow icon="person-remove-outline" title="Delete account" destructive onPress={() => router.push('/account/delete')} testID="me-delete-account" />
        </>
      )}

      <SectionHeader>Your data</SectionHeader>
      <ListRow icon="lock-closed-outline" title="App lock" subtitle="Face ID, fingerprint or phone PIN" onPress={() => router.push('/settings/app-lock')} testID="me-app-lock" />
      <ListRow icon="trash-outline" title={t('me.deleteAll')} destructive onPress={confirmDeleteAll} testID="me-delete-all" />

      <SectionHeader>Privacy and terms</SectionHeader>
      <ListRow icon="shield-checkmark-outline" title="Privacy Policy" onPress={() => router.push('/legal/privacy')} testID="me-privacy" />
      <ListRow icon="document-text-outline" title="Terms of Use" onPress={() => router.push('/legal/terms')} testID="me-terms" />
      <ListRow icon="person-remove-outline" title="How to delete your account" onPress={() => router.push('/legal/delete-account')} testID="me-delete-info" />

      <SectionHeader>About</SectionHeader>
      <ListRow icon="information-circle-outline" title={`${t('app.name')} ${version}`} subtitle="P1 core app (beta)" onPress={tapVersion} testID="me-version" />
      <Surface>
        <Caption>
          Fonts: Gaegu, Nunito, Cinzel, Crimson Pro and Atkinson Hyperlegible, each under the SIL Open Font License
          1.1. Style pack art is original.
        </Caption>
      </Surface>
      {devMenu ? <ListRow icon="construct-outline" title="Developer menu (P0 spike lab)" onPress={() => router.push('/dev')} testID="me-dev" /> : null}
    </AppScreen>
  );
}
