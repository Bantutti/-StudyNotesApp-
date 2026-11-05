/** Subjects: Inbox plus subject cards (colour, counts). Long press to edit or delete. */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { useAppData, useDataVersion } from '@/composition';
import { t, tCount, userMessage } from '@/core';
import { AppButton, AppScreen, Banner, BodyText, EmptyState, ListRow, SectionHeader } from '@/core/ui';
import type { Subject, UndoToken } from '@/modules/store';

export default function Subjects() {
  const { store, showUndo } = useAppData();
  const version = useDataVersion();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [counts, setCounts] = useState<Map<string | null, number>>(new Map());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setStatus('loading');
      setLoadError(null);
      // Catch both rejected promises and synchronous port failures.
      void (async () => {
        try {
          const [s, c] = await Promise.all([
            Promise.resolve().then(() => store.subjects.list()),
            Promise.resolve().then(() => store.notes.counts()),
          ]);
          if (!alive) return;
          setSubjects(s);
          setCounts(c);
          setStatus('ready');
        } catch (e) {
          if (!alive) return;
          setLoadError(userMessage(e));
          setStatus('error');
        }
      })();
      return () => {
        alive = false;
      };
    }, [store, version, retry]), // eslint-disable-line react-hooks/exhaustive-deps -- version triggers reloads
  );

  const menu = (s: Subject) =>
    Alert.alert(s.name, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: 'Edit', onPress: () => router.push({ pathname: '/subject-form', params: { id: s.id } }) },
      { text: t('common.delete'), style: 'destructive', onPress: () => confirmDelete(s) },
    ]);

  const deleteSubject = async (s: Subject, mode: 'move' | 'delete') => {
    setActionError(null);
    let token: UndoToken;
    try {
      token = await store.subjects.remove(s.id, mode);
    } catch (e) {
      setActionError(`Could not delete subject. ${userMessage(e)}`);
      return;
    }
    try {
      showUndo(mode === 'move' ? 'Subject deleted. Notes moved to Inbox.' : 'Subject and its notes deleted.', token);
    } catch (e) {
      setActionError(`Subject deleted, but Undo could not be shown. ${userMessage(e)}`);
    }
  };

  const confirmDelete = (s: Subject) =>
    Alert.alert(t('subjects.deleteAsk', { name: s.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('subjects.deleteMove'), onPress: () => void deleteSubject(s, 'move') },
      { text: t('subjects.deleteAll'), style: 'destructive', onPress: () => void deleteSubject(s, 'delete') },
    ]);

  return (
    <AppScreen>
      <AppButton label={t('subjects.new')} icon="add" onPress={() => router.push('/subject-form')} testID="subjects-new" />
      {actionError ? <Banner>{actionError}</Banner> : null}
      {status === 'loading' ? <BodyText>Loading subjects…</BodyText> : null}
      {status === 'error' ? (
        <>
          <Banner>Could not load subjects. {loadError}</Banner>
          <AppButton label="Retry" onPress={() => setRetry((x) => x + 1)} testID="subjects-load-retry" />
        </>
      ) : null}
      {status === 'ready' ? (
        <>
          <ListRow icon="file-tray-outline" title={t('subjects.inbox')} trailing={tCount('subjects.noteCount', counts.get(null) ?? 0)} onPress={() => router.push('/inbox')} testID="subjects-inbox" />
          <SectionHeader>{t('subjects.title')}</SectionHeader>
          {subjects.length === 0 ? (
            <EmptyState title="No subjects yet" body="Subjects keep a semester tidy: one per class." />
          ) : (
            <View style={{ gap: 8 }}>
              {subjects.map((s) => (
                <ListRow
                  key={s.id}
                  testID={`subject-${s.id}`}
                  dot={`#${s.color}`}
                  title={s.name}
                  trailing={tCount('subjects.noteCount', counts.get(s.id) ?? 0)}
                  onPress={() => router.push({ pathname: '/subject/[id]', params: { id: s.id } })}
                  onLongPress={() => menu(s)}
                  hint="Long press to edit or delete"
                />
              ))}
            </View>
          )}
        </>
      ) : null}
    </AppScreen>
  );
}
