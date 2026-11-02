/**
 * Pick your look (plan Flow 1): the selected pack rendered live on the real
 * sample page, above a grid of every v1 pack (P5). Also opened from
 * Me > Default look (?from=settings), where it just saves.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { isOfferedPack, skipOnboarding, usePackFaces, usePackList, useStore } from '@/composition';
import { SAMPLE_NOTE, t } from '@/core';
import { AppButton, AppScreen, BodyText, Title } from '@/core/ui';
import { PagePreview } from '@/modules/editor';
import { DEFAULT_PACK_ID, PackPicker } from '@/modules/stylepacks';

/** One live page preview (a WebView) of the selected look; the grid below is native swatches (P5 Q9). */
function LivePreview({ id }: { id: string }) {
  const { pack, faces } = usePackFaces(id);
  return <PagePreview doc={SAMPLE_NOTE} pack={pack} faces={faces ?? []} height={260} zoom={0.62} label={`${pack.name} preview`} />;
}

export default function PickLook() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const settingsMode = from === 'settings';
  const store = useStore();
  const { packs, customIds } = usePackList();
  const [selected, setSelected] = useState<string>(DEFAULT_PACK_ID);

  useEffect(() => {
    let alive = true;
    store.settings.get().then((s) => {
      if (alive && s.defaultPack && isOfferedPack(s.defaultPack)) setSelected(s.defaultPack);
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
      <LivePreview id={selected} />
      <PackPicker packs={packs} customIds={customIds} selected={selected} onSelect={setSelected} testIDPrefix="look" />
      <AppButton label={settingsMode ? t('common.save') : t('common.next')} onPress={next} testID="look-next" />
      {settingsMode ? null : <AppButton kind="plain" label={t('common.skip')} onPress={skip} />}
    </AppScreen>
  );
}
