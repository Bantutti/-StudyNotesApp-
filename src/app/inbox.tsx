/** Inbox: notes and folders without a subject. */
import { Stack } from 'expo-router';

import { t } from '@/core';
import { NoteBrowser } from '@/screens/NoteBrowser';

export default function Inbox() {
  return (
    <>
      <Stack.Screen options={{ title: t('subjects.inbox') }} />
      <NoteBrowser subjectId={null} />
    </>
  );
}
