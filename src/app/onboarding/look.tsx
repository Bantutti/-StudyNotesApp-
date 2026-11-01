/**
 * Pick your look: each P1 pack rendered on the real sample page (plan Flow 1).
 * Also opened from Me > Default look (?from=settings), where it just saves.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { isP1Pack, skipOnboarding, usePackFaces, useServices, useStore } from '@/composition';
import { SAMPLE_NOTE, t } from '@/core';
import { AppButton, AppScreen, BodyText, Caption, Icon, Title, useTheme } from '@/core/ui';
import { PagePreview } from '@/modules/editor';
import { DEFAULT_PACK_ID, P1_PACK_IDS } from '@/modules/stylepacks';

function PackCard({ id, selected, onPress }: { id: string; selected: boolean; onPress: () => void }) {
  const th = useTheme();
  const { pack, faces } = usePackFaces(id);
  return (
    <Pressable
      testID={`look-${id}`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${pack.name}. ${pack.meta.mood}. Best for ${pack.meta.bestFor}.`}
      onPress={onPress}
      style={[styles.card, { borderColor: selected ? th.accent : th.line, backgroundColor: th.surface, borderRadius: th.radius.card }]}
    >
      <PagePreview doc={SAMPLE_NOTE} pack={pack} faces={faces ?? []} height={230} zoom={0.62} label={`${pack.name} preview`} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <BodyText>{pack.name}</BodyText>
          <Caption>{pack.meta.bestFor}</Caption>
        </View>
        {selected ? <Icon name="checkmark-circle" color={th.accent} size={28} /> : null}
      </View>
    </Pressable>
  );
}

export default function PickLook() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const settingsMode = from === 'settings';
  const store = useStore();
  useServices();
  const [selected, setSelected] = useState<string>(DEFAULT_PACK_ID);

  useEffect(() => {
    let alive = true;
    store.settings.get().then((s) => {
      if (alive && s.defaultPack && isP1Pack(s.defaultPack)) setSelected(s.defaultPack);
    });
    return () => {
      alive = false;
    };
  }, [store]);

  const next = async () => {
    if (settingsMode) {
      await store.settings.update({ defaultPack: selected });
      router.back();
    } else router.push({ pathname: '/onboarding/subject', params: { pack: selected } });
  };
  const skip = async () => {
    await skipOnboarding(store, selected);
    router.replace('/home');
  };

  return (
    <AppScreen edges={['top', 'bottom', 'left', 'right']}>
      <Title size="largeTitle">{t('look.title')}</Title>
      <BodyText muted>{t('look.body')}</BodyText>
      {P1_PACK_IDS.map((id) => (
        <PackCard key={id} id={id} selected={selected === id} onPress={() => setSelected(id)} />
      ))}
      <AppButton label={settingsMode ? t('common.save') : t('common.next')} onPress={next} testID="look-next" />
      {settingsMode ? null : <AppButton kind="plain" label={t('common.skip')} onPress={skip} />}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, padding: 8, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 4, gap: 8 },
  flex: { flex: 1 },
});
