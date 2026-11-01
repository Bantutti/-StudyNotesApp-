/**
 * Me (P1 subset): default look, Delete all data, About and font licences,
 * and the hidden developer menu (tap the version 7 times; only in dev mode
 * or a development build, see devToolsAllowed). P2b adds
 * account, sync, app lock and storage here.
 */
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { createTapUnlock, devMenuUnlocked, KEY_DEV_MENU, KV_APP, useAppData, useServices } from '@/composition';
import { t, userMessage } from '@/core';
import { AppScreen, BodyText, Caption, ListRow, SectionHeader, Surface } from '@/core/ui';
import { DEFAULT_PACK_ID } from '@/modules/stylepacks';

export default function Me() {
  const { store, resetAll } = useAppData();
  const { packs, devTools } = useServices();
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

      <SectionHeader>Your data</SectionHeader>
      <Surface>
        <BodyText muted>
          Your notes are saved on this phone only. Nothing is uploaded: there is no account yet, and AI and sync are
          not turned on.
        </BodyText>
      </Surface>
      <ListRow icon="trash-outline" title={t('me.deleteAll')} destructive onPress={confirmDeleteAll} testID="me-delete-all" />

      <SectionHeader>About</SectionHeader>
      <ListRow icon="information-circle-outline" title={`${t('app.name')} ${version}`} subtitle="P1 core app (beta)" onPress={tapVersion} testID="me-version" />
      <ListRow icon="document-text-outline" title="Font licences" subtitle="22 fonts, SIL Open Font License 1.1" onPress={() => router.push('/font-licenses')} testID="me-font-licences" />
      <Surface>
        <Caption>Style pack art is original.</Caption>
      </Surface>
      {devMenu ? <ListRow icon="construct-outline" title="Developer menu (P0 spike lab)" onPress={() => router.push('/dev')} testID="me-dev" /> : null}
    </AppScreen>
  );
}
