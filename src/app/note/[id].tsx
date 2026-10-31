/** Note screen. The full editor arrives in M5; for now it shows the note read-only. */
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { displayTitle, rememberOpenedNote, usePackFaces, useStore } from '@/composition';
import type { NoteDoc } from '@/core';
import { AppScreen, BodyText, Spinner } from '@/core/ui';
import { PagePreview } from '@/modules/editor';
import type { Note } from '@/modules/store';
import { DEFAULT_PACK_ID } from '@/modules/stylepacks';

function Page({ doc, packId }: { doc: NoteDoc; packId: string }) {
  const { pack, faces } = usePackFaces(packId);
  return <PagePreview doc={doc} pack={pack} faces={faces ?? []} height={560} zoom={1} label="Note page" />;
}

export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const [note, setNote] = useState<Note | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    store.notes.get(String(id)).then((n) => {
      if (!alive) return;
      setNote(n && !n.deleted ? n : null);
      if (n && !n.deleted) void rememberOpenedNote(store, n.id);
    });
    return () => {
      alive = false;
    };
  }, [store, id]);
  if (note === undefined) return <Spinner />;
  if (note === null) return <BodyText>This note no longer exists.</BodyText>;
  return (
    <AppScreen>
      <Stack.Screen options={{ title: displayTitle(note) }} />
      <BodyText muted>Read-only for now: the editor arrives in the next milestone (M5).</BodyText>
      <Page doc={note.document} packId={note.stylePackId || DEFAULT_PACK_ID} />
    </AppScreen>
  );
}
