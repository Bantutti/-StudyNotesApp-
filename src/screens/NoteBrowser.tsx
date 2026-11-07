/**
 * Note list for a subject (with its folders) or the Inbox: sort, tag
 * filter, folders (one level in P1), empty state, long-press actions.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { createNoteIn, SAMPLE_TAG, useAppData, useDataVersion, useTemplateDeps } from '@/composition';
import { t, tCount, userMessage } from '@/core';
import { AppButton, AppScreen, Banner, BodyText, EmptyState, ListRow, SectionHeader, useTheme } from '@/core/ui';
import type { Folder, NoteListItem, NoteSort, UndoToken } from '@/modules/store';

import { NoteCard } from './NoteCard';

export interface NoteBrowserProps {
  subjectId: string | null;
  /** Inside a subject: undefined = whole subject (root), a folder id = that folder. */
  folderId?: string;
}

const SORTS: { key: NoteSort; label: string }[] = [
  { key: 'updated', label: 'Recent' },
  { key: 'title', label: 'A–Z' },
  { key: 'created', label: 'Created' },
];

export function NoteBrowser({ subjectId, folderId }: NoteBrowserProps) {
  const th = useTheme();
  const { store, showUndo } = useAppData();
  const templateDeps = useTemplateDeps();
  const version = useDataVersion();
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<NoteSort>('updated');
  const [tag, setTag] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [creating, setCreating] = useState(false);
  const mounted = useRef(false);
  const focused = useRef(false);
  const generation = useRef(0);
  const flight = useRef<{ pending: boolean } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Keep this separate from the list reload effect: filtering is not a blur.
  useFocusEffect(useCallback(() => {
    focused.current = true;
    generation.current += 1;
    if (!flight.current) setCreating(false);
    return () => {
      focused.current = false;
      generation.current += 1;
      if (flight.current && !flight.current.pending) flight.current = null;
    };
  }, [subjectId, folderId])); // eslint-disable-line react-hooks/exhaustive-deps -- scope changes invalidate pending creation

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const scope = subjectId === null ? ({ scope: 'inbox', folderId: folderId ?? null } as const) : ({ scope: 'subject', subjectId, folderId: folderId ?? null } as const);
      setStatus('loading');
      setLoadError(null);
      void (async () => {
        try {
          const [n, f, tg] = await Promise.all([
            Promise.resolve().then(() => store.notes.list(scope, { sort, tag: tag ?? undefined })),
            folderId ? Promise.resolve([] as Folder[]) : Promise.resolve().then(() => store.folders.list(subjectId)),
            Promise.resolve().then(() => store.notes.tags(subjectId ?? undefined)),
          ]);
          if (!alive) return;
          setNotes(n);
          setFolders(f);
          setTags(tg.map((x) => x.tag).filter((x) => x !== SAMPLE_TAG));
          setNow(Date.now());
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
    }, [store, subjectId, folderId, sort, tag, version, retry]), // eslint-disable-line react-hooks/exhaustive-deps -- version triggers reloads
  );

  const newNote = async () => {
    if (!mounted.current || !focused.current || flight.current) return;
    const current = { pending: true };
    const started = generation.current;
    flight.current = current; // Lock synchronously, before React renders the busy state.
    setCreating(true);
    setActionError(null);
    let id: string;
    try {
      id = (await createNoteIn(store, { subject: subjectId, folder: folderId ?? null }, {}, templateDeps)).id;
    } catch (e) {
      flight.current = null;
      if (mounted.current) {
        setCreating(false);
        setActionError(`Could not create note. ${userMessage(e)} Use New note to try again.`);
      }
      return;
    }
    current.pending = false;
    if (!mounted.current || !focused.current || generation.current !== started) {
      flight.current = null;
      if (mounted.current) setCreating(false);
      return;
    }
    try {
      router.push({ pathname: '/note/[id]', params: { id } });
      // Keep the lock until focus leaves so repeated taps cannot create another note.
    } catch {
      flight.current = null;
      if (mounted.current && focused.current && generation.current === started) {
        setCreating(false);
        setActionError('Note created, but could not be opened. Find it in the list and open it there.');
      }
    }
  };

  const folderMenu = (f: Folder) =>
    Alert.alert(f.name, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.rename'), onPress: () => router.push({ pathname: '/folder-form', params: { id: f.id } }) },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setActionError(null);
          let token: UndoToken;
          try {
            token = await store.folders.remove(f.id);
          } catch (e) {
            setActionError(`Could not delete folder. ${userMessage(e)}`);
            return;
          }
          try {
            showUndo('Folder deleted. Its notes moved up.', token);
          } catch (e) {
            setActionError(`Folder deleted, but Undo could not be shown. ${userMessage(e)}`);
          }
        },
      },
    ]);

  return (
    <AppScreen>
      <View style={styles.actions}>
        <View style={styles.flex}>
          <AppButton label={t('notes.new')} icon="add" onPress={() => void newNote()} busy={creating} testID="browser-new-note" />
        </View>
        {folderId ? null : (
          <AppButton
            kind="secondary"
            label={t('folders.new')}
            icon="folder-outline"
            onPress={() => router.push({ pathname: '/folder-form', params: { subject: subjectId ?? '' } })}
          />
        )}
      </View>

      {actionError ? <Banner>{actionError}</Banner> : null}
      {status === 'loading' ? <BodyText>Loading notes…</BodyText> : null}
      {status === 'error' ? (
        <>
          <Banner>Could not load notes and folders. {loadError}</Banner>
          <AppButton label="Retry" onPress={() => setRetry((x) => x + 1)} testID="browser-load-retry" />
        </>
      ) : null}
      {status === 'ready' ? (
        <>
          {folders.length > 0 ? (
            <View style={styles.gap}>
              <SectionHeader>Folders</SectionHeader>
              {folders.map((f) => (
                <ListRow
                  key={f.id}
                  testID={`folder-${f.id}`}
                  icon="folder-outline"
                  title={f.name}
                  onPress={() => router.push({ pathname: '/folder/[id]', params: { id: f.id } })}
                  onLongPress={() => folderMenu(f)}
                  hint="Long press to rename or delete"
                />
              ))}
            </View>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {SORTS.map((s) => (
              <Chip key={s.key} label={s.label} active={sort === s.key} onPress={() => setSort(s.key)} />
            ))}
            {tags.map((x) => (
              <Chip key={x} label={`#${x}`} active={tag === x} onPress={() => setTag(tag === x ? null : x)} />
            ))}
          </ScrollView>

          <SectionHeader>{tCount('subjects.noteCount', notes.length)}</SectionHeader>
          {notes.length === 0 ? (
            <EmptyState title={t('subjects.empty')} body={tag ? `No notes tagged #${tag}.` : 'Start with a blank page or a template.'}>
              <AppButton label={t('notes.new')} icon="add" onPress={() => void newNote()} busy={creating} testID="browser-empty-new-note" />
              <AppButton
                kind="secondary"
                label={t('notes.fromTemplate')}
                testID="browser-from-template"
                icon="copy-outline"
                onPress={() => router.push({ pathname: '/templates', params: { mode: 'new', subject: subjectId ?? '', folder: folderId ?? '' } })}
              />
            </EmptyState>
          ) : (
            notes.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                now={now}
                onPress={() => router.push({ pathname: '/note/[id]', params: { id: n.id } })}
                onLongPress={() => router.push({ pathname: '/note-actions', params: { id: n.id } })}
              />
            ))
          )}
        </>
      ) : null}
      <View style={{ height: th.space.xxl }} />
    </AppScreen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.chip,
        { borderRadius: th.radius.chip, borderColor: active ? th.accent : th.line, backgroundColor: active ? th.primary.fill : th.surface },
      ]}
    >
      <Text style={{ color: active ? th.primary.text : th.text, fontSize: th.type.caption, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  gap: { gap: 8 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1 },
});
