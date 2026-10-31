/** One subject: its folders and notes, in the subject's colour. */
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useDataVersion, useStore } from '@/composition';
import { AccentProvider, IconButton, Spinner } from '@/core/ui';
import type { Subject } from '@/modules/store';
import { NoteBrowser } from '@/screens/NoteBrowser';

export default function SubjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const version = useDataVersion();
  const [subject, setSubject] = useState<Subject | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    store.subjects.get(String(id)).then((s) => alive && setSubject(s && !s.deleted ? s : null));
    return () => {
      alive = false;
    };
  }, [store, id, version]);

  if (subject === undefined) return <Spinner />;
  if (subject === null) return <Redirect href="/subjects" />;
  return (
    <AccentProvider color={subject.color}>
      <Stack.Screen
        options={{
          title: subject.name,
          headerRight: () => (
            <IconButton icon="create-outline" label="Edit subject" onPress={() => router.push({ pathname: '/subject-form', params: { id: subject.id } })} />
          ),
        }}
      />
      <NoteBrowser subjectId={subject.id} />
    </AccentProvider>
  );
}
