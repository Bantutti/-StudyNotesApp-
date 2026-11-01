/** Subjects: Inbox plus subject cards (colour, counts). Long press to edit or delete. */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { useAppData, useDataVersion } from '@/composition';
import { t, tCount } from '@/core';
import { AppButton, AppScreen, EmptyState, ListRow, SectionHeader } from '@/core/ui';
import type { Subject } from '@/modules/store';

export default function Subjects() {
  const { store, showUndo } = useAppData();
  const version = useDataVersion();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [counts, setCounts] = useState<Map<string | null, number>>(new Map());

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.all([store.subjects.list(), store.notes.counts()]).then(([s, c]) => {
        if (!alive) return;
        setSubjects(s);
        setCounts(c);
      });
      return () => {
        alive = false;
      };
    }, [store, version]), // eslint-disable-line react-hooks/exhaustive-deps -- version triggers reloads
  );

  const menu = (s: Subject) =>
    Alert.alert(s.name, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: 'Edit', onPress: () => router.push({ pathname: '/subject-form', params: { id: s.id } }) },
      { text: t('common.delete'), style: 'destructive', onPress: () => confirmDelete(s) },
    ]);

  const confirmDelete = (s: Subject) =>
    Alert.alert(t('subjects.deleteAsk', { name: s.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('subjects.deleteMove'), onPress: async () => showUndo('Subject deleted. Notes moved to Inbox.', await store.subjects.remove(s.id, 'move')) },
      { text: t('subjects.deleteAll'), style: 'destructive', onPress: async () => showUndo('Subject and its notes deleted.', await store.subjects.remove(s.id, 'delete')) },
    ]);

  return (
    <AppScreen>
      <AppButton label={t('subjects.new')} icon="add" onPress={() => router.push('/subject-form')} testID="subjects-new" />
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
    </AppScreen>
  );
}
