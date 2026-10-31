/** One folder inside a subject (or the Inbox). */
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useDataVersion, useStore } from '@/composition';
import { AccentProvider, Spinner } from '@/core/ui';
import type { Folder } from '@/modules/store';
import { NoteBrowser } from '@/screens/NoteBrowser';

export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const version = useDataVersion();
  const [folder, setFolder] = useState<Folder | null | undefined>(undefined);
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    store.folders.get(String(id)).then(async (f) => {
      if (!alive) return;
      setFolder(f && !f.deleted ? f : null);
      if (f?.subject) setColor((await store.subjects.get(f.subject))?.color ?? null);
    });
    return () => {
      alive = false;
    };
  }, [store, id, version]);

  if (folder === undefined) return <Spinner />;
  if (folder === null) return <Redirect href="/subjects" />;
  return (
    <AccentProvider color={color}>
      <Stack.Screen options={{ title: folder.name }} />
      <NoteBrowser subjectId={folder.subject} folderId={folder.id} />
    </AccentProvider>
  );
}
