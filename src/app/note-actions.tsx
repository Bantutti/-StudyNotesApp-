/** Long-press actions for a note: move to a subject or the Inbox, delete (with Undo). */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { displayTitle, useAppData } from '@/composition';
import { t, tCount, userMessage } from '@/core';
import { AppButton, AppScreen, Banner, BodyText, ListRow, SectionHeader } from '@/core/ui';
import type { Note, Subject, UndoToken } from '@/modules/store';

export default function NoteActions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, showUndo } = useAppData();
  const [note, setNote] = useState<Note | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    // The route id can change without unmounting. Reset the previous note's
    // actions immediately so they cannot be used while the new note loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- invalidate stale destructive actions on route/retry change
    setStatus('loading');
    setLoadError(null);
    // The async wrapper also catches ports that throw before returning a promise.
    void (async () => {
      try {
        const [n, s] = await Promise.all([
          Promise.resolve().then(() => store.notes.get(String(id))),
          Promise.resolve().then(() => store.subjects.list()),
        ]);
        if (!alive) return;
        setNote(n && !n.deleted ? n : null);
        setSubjects(s);
        setStatus('ready');
      } catch (e) {
        if (!alive) return;
        setLoadError(userMessage(e));
        setStatus('error');
      }
    })();
    return () => { alive = false; };
  }, [store, id, retry]);

  if (status !== 'ready') return (
    <AppScreen>
      {status === 'loading' ? <BodyText>Loading note actions…</BodyText> : (
        <>
          <Banner>Could not load note actions. {loadError}</Banner>
          <AppButton label="Retry" onPress={() => setRetry((x) => x + 1)} testID="note-actions-load-retry" />
        </>
      )}
    </AppScreen>
  );
  if (!note) return <AppScreen><BodyText>This note no longer exists.</BodyText></AppScreen>;

  const move = async (subject: string | null) => {
    setError(null);
    try {
      await store.notes.save(note.id, { subject, folder: null });
      router.back();
    } catch (e) {
      setError(userMessage(e));
    }
  };
  const remove = async () => {
    setError(null);
    let token: UndoToken;
    try {
      token = await store.notes.remove([note.id]);
    } catch (e) {
      setError(`Could not delete note. ${userMessage(e)}`);
      return;
    }
    try {
      router.back();
      showUndo(tCount('notes.deleted', 1), token);
    } catch (e) {
      setError(`Note deleted, but navigation or Undo could not be completed. ${userMessage(e)}`);
    }
  };

  return (
    <AppScreen>
      <Stack.Screen options={{ title: displayTitle(note) }} />
      <SectionHeader>Move to</SectionHeader>
      <ListRow icon="file-tray-outline" title={t('subjects.inbox')} onPress={() => move(null)} trailing={note.subject === null ? 'Current' : undefined} />
      {subjects.map((s) => (
        <ListRow key={s.id} dot={`#${s.color}`} title={s.name} onPress={() => move(s.id)} trailing={note.subject === s.id ? 'Current' : undefined} />
      ))}
      {error ? <Banner>{error}</Banner> : null}
      <SectionHeader>Note</SectionHeader>
      <ListRow icon="trash-outline" title={t('common.delete')} destructive onPress={remove} testID="note-delete" />
    </AppScreen>
  );
}
