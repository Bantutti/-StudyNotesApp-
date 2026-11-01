/** Long-press actions for a note: move to a subject or the Inbox, delete (with Undo). */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { displayTitle, useAppData } from '@/composition';
import { t, tCount, userMessage } from '@/core';
import { AppScreen, BodyText, ListRow, SectionHeader } from '@/core/ui';
import type { Note, Subject } from '@/modules/store';

export default function NoteActions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, showUndo } = useAppData();
  const [note, setNote] = useState<Note | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([store.notes.get(String(id)), store.subjects.list()]).then(([n, s]) => {
      if (!alive) return;
      setNote(n);
      setSubjects(s);
    });
    return () => {
      alive = false;
    };
  }, [store, id]);

  if (!note) return null;
  const move = async (subject: string | null) => {
    try {
      await store.notes.save(note.id, { subject, folder: null });
      router.back();
    } catch (e) {
      setError(userMessage(e));
    }
  };
  const remove = async () => {
    const token = await store.notes.remove([note.id]);
    router.back();
    showUndo(tCount('notes.deleted', 1), token);
  };

  return (
    <AppScreen>
      <Stack.Screen options={{ title: displayTitle(note) }} />
      <SectionHeader>Move to</SectionHeader>
      <ListRow icon="file-tray-outline" title={t('subjects.inbox')} onPress={() => move(null)} trailing={note.subject === null ? 'Current' : undefined} />
      {subjects.map((s) => (
        <ListRow key={s.id} dot={`#${s.color}`} title={s.name} onPress={() => move(s.id)} trailing={note.subject === s.id ? 'Current' : undefined} />
      ))}
      {error ? <BodyText>{error}</BodyText> : null}
      <SectionHeader>Note</SectionHeader>
      <ListRow icon="trash-outline" title={t('common.delete')} destructive onPress={remove} testID="note-delete" />
    </AppScreen>
  );
}
