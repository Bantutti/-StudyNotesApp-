/** The centre + sheet: New note, From template, Match a look (P5), New subject. */
import { router } from 'expo-router';
import { useCallback } from 'react';

import { useStore } from '@/composition';
import { t } from '@/core';
import { AppButton, AppScreen, Banner, BodyText, ListRow, Surface } from '@/core/ui';
import { useCreateBlankNote } from '@/screens/useCreateBlankNote';

export default function NewSheet() {
  const store = useStore();
  const open = useCallback((id: string) => {
    router.replace({ pathname: '/note/[id]', params: { id } });
  }, []);
  const { busy, create: newNote, error } = useCreateBlankNote(store, open);
  return (
    <AppScreen>
      {error ? <Banner>{error}</Banner> : null}
      <Surface>
        <BodyText muted>A blank page in your default look</BodyText>
        <AppButton icon="document-text-outline" label={t('notes.new')} onPress={() => void newNote()} busy={busy} testID="new-note" />
      </Surface>
      <ListRow icon="copy-outline" title={t('notes.fromTemplate')} subtitle="Lecture, Cornell, Outline and more" onPress={() => router.replace('/templates?mode=new')} testID="new-from-template" />
      <ListRow icon="color-palette-outline" title="Match a look" subtitle="Make a look from a photo of notes you like" onPress={() => router.replace('/match')} testID="new-match" />
      <ListRow icon="albums-outline" title={t('subjects.new')} onPress={() => router.replace('/subject-form')} />
    </AppScreen>
  );
}
