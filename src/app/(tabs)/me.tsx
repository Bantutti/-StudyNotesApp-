/**
 * Me (P1 subset): default look, Delete all data, About and font licences,
 * and the hidden developer menu (tap the version 7 times). P2b adds
 * account, sync, app lock and storage here.
 */
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import * as z from 'zod';

import { createTapUnlock, KEY_DEV_MENU, KV_APP, useAppData, useServices } from '@/composition';
import { t, userMessage } from '@/core';
import { AppScreen, BodyText, Caption, ListRow, SectionHeader, Surface } from '@/core/ui';
import { DEFAULT_PACK_ID } from '@/modules/stylepacks';

export default function Me() {
  const { store, resetAll } = useAppData();
  const { packs } = useServices();
  const [devMenu, setDevMenu] = useState(false);
  const [packId, setPackId] = useState<string>(DEFAULT_PACK_ID);
  const unlock = useMemo(() => createTapUnlock(), []);
  const version = Constants.expoConfig?.version ?? '0.0.0';

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.all([store.kv.get(KV_APP, KEY_DEV_MENU, z.boolean()), store.settings.get()]).then(([dev, settings]) => {
        if (!alive) return;
        setDevMenu(dev === true);
        setPackId(settings.defaultPack ?? DEFAULT_PACK_ID);
      });
      return () => {
        alive = false;
      };
    }, [store]),
  );

  const tapVersion = async () => {
    if (devMenu) return;
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
        <BodyText muted>{t('me.dataAi')}</BodyText>
      </Surface>
      <ListRow icon="sparkles-outline" title={t('me.ai')} subtitle={t('me.aiRow')} onPress={() => router.push('/ai/settings')} testID="me-ai" />
      <ListRow icon="trash-outline" title={t('me.deleteAll')} destructive onPress={confirmDeleteAll} testID="me-delete-all" />

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
