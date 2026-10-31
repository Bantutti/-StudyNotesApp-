/** The centre + sheet: New note (more options arrive with templates in M6). */
import { router } from 'expo-router';

import { createNoteIn, useStore } from '@/composition';
import { t } from '@/core';
import { AppScreen, ListRow } from '@/core/ui';

export default function NewSheet() {
  const store = useStore();
  const newNote = async () => {
    const n = await createNoteIn(store, { subject: null });
    router.dismiss();
    router.push({ pathname: '/note/[id]', params: { id: n.id } });
  };
  return (
    <AppScreen>
      <ListRow icon="document-text-outline" title={t('notes.new')} subtitle="A blank page in your default look" onPress={newNote} testID="new-note" />
      <ListRow icon="albums-outline" title={t('subjects.new')} onPress={() => router.replace('/subject-form')} />
    </AppScreen>
  );
}
