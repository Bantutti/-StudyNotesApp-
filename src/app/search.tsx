/**
 * Search (plan F2: FTS5 over titles, text and definition terms; decision
 * Q10: one entry per block). Results are grouped by note with highlighted
 * snippets; tapping one opens the note at that line (?block=, jump finished
 * in M5). Snippets are plain text parts, never HTML.
 */
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { createSearchController, displayTitle, useAppData, useServices, type SearchState } from '@/composition';
import { t } from '@/core';
import { AppScreen, BodyText, Caption, EmptyState, Icon, useTheme } from '@/core/ui';
import type { SearchHit, SearchMatch, Subject } from '@/modules/store';

const KIND_LABEL: Record<SearchMatch['kind'], string | null> = { title: 'Title', heading: 'Heading', term: 'Term', text: null };

function Snippet({ m }: { m: SearchMatch }) {
  const th = useTheme();
  const label = KIND_LABEL[m.kind];
  return (
    <Text style={{ color: th.text, fontSize: th.type.caption + 1, lineHeight: 20 }} numberOfLines={3}>
      {label ? <Text style={{ color: th.muted, fontWeight: '700' }}>{label}: </Text> : null}
      {m.snippet.map((p, i) => (
        <Text key={i} style={p.match ? { fontWeight: '800', color: th.accentText } : undefined}>
          {p.text}
        </Text>
      ))}
    </Text>
  );
}

function HitCard({ hit, subject }: { hit: SearchHit; subject: Subject | undefined }) {
  const th = useTheme();
  const { packs } = useServices();
  const pack = packs.getOrDefault(hit.stylePackId);
  const first = hit.matches[0];
  const open = () =>
    router.push({ pathname: '/note/[id]', params: first?.blockId ? { id: hit.noteId, block: first.blockId } : { id: hit.noteId } });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${displayTitle({ title: hit.title, preview: '' })}${subject ? `, ${subject.name}` : ''}. ${hit.matches.map((m) => m.snippet.map((p) => p.text).join('')).join('. ')}`}
      onPress={open}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: th.surface, borderColor: th.line, borderLeftColor: pack.palette.accent, borderRadius: th.radius.card },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.head}>
        <Text numberOfLines={1} style={[styles.title, { color: th.text }]}>
          {hit.title.trim() || t('common.untitled')}
        </Text>
        {subject ? (
          <View style={styles.subject}>
            <View style={[styles.dot, { backgroundColor: `#${subject.color}` }]} />
            <Caption>{subject.name}</Caption>
          </View>
        ) : null}
      </View>
      {hit.matches.map((m, i) => (
        <Snippet key={`${m.blockId ?? 'title'}-${i}`} m={m} />
      ))}
    </Pressable>
  );
}

export default function Search() {
  const th = useTheme();
  const { store } = useAppData();
  const [state, setState] = useState<SearchState>({ query: '', hits: [], busy: false });
  const [subjects, setSubjects] = useState<Map<string, Subject>>(new Map());
  const [ctl] = useState(() => createSearchController({ search: (q) => store.search(q), onChange: setState }));

  useEffect(() => () => ctl.dispose(), [ctl]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      store.subjects.list().then((s) => alive && setSubjects(new Map(s.map((x) => [x.id, x]))));
      ctl.refresh(); // notes may have changed while away
      return () => {
        alive = false;
      };
    }, [store, ctl]),
  );

  return (
    <AppScreen>
      <Stack.Screen options={{ title: 'Search' }} />
      <View style={[styles.box, { backgroundColor: th.surface, borderColor: th.line, borderRadius: th.radius.input }]}>
        <Icon name="search" color={th.muted} size={20} />
        <TextInput
          testID="search-input"
          value={state.query}
          onChangeText={(q) => ctl.setQuery(q.slice(0, 200))}
          placeholder={t('home.searchPlaceholder')}
          placeholderTextColor={th.muted}
          accessibilityLabel={t('home.searchPlaceholder')}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          maxLength={200}
          style={[styles.input, { color: th.text, fontSize: th.type.body }]}
        />
      </View>
      {!state.query.trim() ? (
        <BodyText muted>Search titles, text and definition terms. Words match from the start, so “osmo” finds “Osmosis”.</BodyText>
      ) : state.hits.length === 0 && !state.busy ? (
        <EmptyState title={t('search.empty', { query: state.query.trim() })} body="Try a shorter word or another spelling." />
      ) : (
        state.hits.map((h) => <HitCard key={h.noteId} hit={h} subject={h.subject ? subjects.get(h.subject) : undefined} />)
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  box: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderWidth: 1 },
  input: { flex: 1, minHeight: 44 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 5, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  pressed: { opacity: 0.75 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '700' },
  subject: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
