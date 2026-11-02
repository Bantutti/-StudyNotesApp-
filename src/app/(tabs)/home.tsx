/**
 * Home (P1 subset of plan 9.3): search, continue where you left off, exam
 * countdowns, recent notes, quick actions. Review parts arrive in P4c.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { createNoteIn, examLabel, homeSummary, useAppData, useDataVersion, type HomeSummary } from '@/composition';
import { t, userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, Icon, ListRow, SectionHeader, Surface, Title, useTheme } from '@/core/ui';
import { NeedsAttentionBanner } from '@/screens/SyncChip';
import { NoteCard } from '@/screens/NoteCard';

export default function Home() {
  const th = useTheme();
  const { store } = useAppData();
  const version = useDataVersion();
  const [data, setData] = useState<HomeSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const t0 = Date.now();
      homeSummary(store, t0)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setNow(t0);
        })
        .catch((e: unknown) => alive && setError(userMessage(e)));
      return () => {
        alive = false;
      };
    }, [store, version]), // eslint-disable-line react-hooks/exhaustive-deps -- version triggers reloads
  );

  const open = (id: string) => router.push({ pathname: '/note/[id]', params: { id } });
  const newNote = async () => open((await createNoteIn(store, { subject: null })).id);

  return (
    <AppScreen>
      <Pressable
        testID="home-search"
        accessibilityRole="search"
        accessibilityLabel={t('home.searchPlaceholder')}
        onPress={() => router.push('/search')}
        style={[styles.search, { backgroundColor: th.surface, borderColor: th.line, borderRadius: th.radius.input }]}
      >
        <Icon name="search" color={th.muted} size={20} />
        <Text style={{ color: th.muted, fontSize: th.type.body }}>{t('home.searchPlaceholder')}</Text>
      </Pressable>

      {error ? <BodyText>{error}</BodyText> : null}
      <NeedsAttentionBanner />

      {data?.exams.length ? (
        <View style={styles.gap}>
          {data.exams.map((e) => (
            <ListRow
              key={e.subjectId}
              dot={`#${e.color}`}
              icon="calendar-outline"
              title={examLabel(e)}
              onPress={() => router.push({ pathname: '/subject/[id]', params: { id: e.subjectId } })}
            />
          ))}
        </View>
      ) : null}

      {data && !data.hasAnyNote ? (
        <Surface>
          <Title>{t('home.firstNote')}</Title>
          <BodyText muted>A blank page in your favourite look. No account needed.</BodyText>
          <AppButton label={t('notes.new')} icon="add" onPress={newNote} testID="home-first-note" />
        </Surface>
      ) : null}

      {data?.continueNote ? (
        <View style={styles.gap}>
          <SectionHeader>{t('home.continue')}</SectionHeader>
          <NoteCard note={data.continueNote} now={now} onPress={() => open(data.continueNote!.id)} />
        </View>
      ) : null}

      {data?.recent.length ? (
        <View style={styles.gap}>
          <SectionHeader>{t('home.recent')}</SectionHeader>
          {data.recent.map((n) => (
            <NoteCard key={n.id} note={n} now={now} onPress={() => open(n.id)} onLongPress={() => router.push({ pathname: '/note-actions', params: { id: n.id } })} />
          ))}
        </View>
      ) : null}

      {data?.hasAnyNote ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <AppButton kind="secondary" icon="add" label={t('notes.new')} onPress={newNote} />
          </View>
          <View style={styles.flex}>
            <AppButton kind="secondary" icon="albums-outline" label={t('subjects.new')} onPress={() => router.push('/subject-form')} />
          </View>
        </View>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  search: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderWidth: 1 },
  gap: { gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
