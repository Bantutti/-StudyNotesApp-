/**
 * Note screen.
 * Now (M6–M10): the page rendered in its pack (read-only, links never open),
 * an action bar (editor actions such as Beautify, Style, History, Add
 * template) and Undo snackbars.
 * Finish in M5: the page becomes the TipTap editor (autosave, keyboard
 * toolbar, slash menu); the EditorHost below switches from the stored
 * document to the live editor (requestDoc / load); ?block= jumps to a line.
 */
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { displayTitle, rememberOpenedNote, runEditorAction, useAppData, useDataVersion, usePackFaces, useServices } from '@/composition';
import { userMessage, type NoteDoc } from '@/core';
import { AppButton, BodyText, Caption, Spinner, useTheme, type IconName } from '@/core/ui';
import { PagePreview, type EditorAction, type EditorHost } from '@/modules/editor';
import type { Note } from '@/modules/store';

function Page({ doc, packId }: { doc: NoteDoc; packId: string }) {
  const { pack, faces } = usePackFaces(packId);
  return <PagePreview doc={doc} pack={pack} faces={faces ?? []} zoom={1} label="Note page" scrollable />;
}

export default function NoteScreen() {
  const th = useTheme();
  const { id, block } = useLocalSearchParams<{ id: string; block?: string }>();
  const { store, showActionUndo } = useAppData();
  const { editorActions, ids } = useServices();
  const version = useDataVersion();
  const [note, setNote] = useState<Note | null | undefined>(undefined);
  const [doc, setDoc] = useState<NoteDoc | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      store.notes.get(String(id)).then((n) => {
        if (!alive) return;
        setNote(n && !n.deleted ? n : null);
        setDoc(n && !n.deleted ? n.document : null);
        if (n && !n.deleted) void rememberOpenedNote(store, n.id);
      });
      return () => {
        alive = false;
      };
    }, [store, id, version]), // eslint-disable-line react-hooks/exhaustive-deps -- version triggers reloads
  );

  // M5: replace with an editor-backed host (editor.requestDoc / getSelection / load).
  const host = useMemo<EditorHost>(
    () => ({
      getDocument: async () => doc ?? { type: 'doc', content: [] },
      getSelection: async () => null,
      showDocument: (d) => setDoc(d),
    }),
    [doc],
  );

  if (note === undefined) return <Spinner />;
  if (note === null || !doc) return <BodyText>This note no longer exists.</BodyText>;

  const run = async (action: EditorAction) => {
    setBusy(action.id);
    try {
      const outcome = await runEditorAction(action, { store, ids, host }, note.id);
      if (outcome) showActionUndo(outcome.message, outcome.undo);
      else Alert.alert(action.label, 'Nothing to change here.');
    } catch (e) {
      Alert.alert(action.label, userMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: th.bg }]}>
      <Stack.Screen options={{ title: displayTitle({ ...note, document: doc }) }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bar}>
        {editorActions.list('toolbar').map((a) => (
          <AppButton key={a.id} kind="secondary" icon={a.icon as IconName} label={a.label} busy={busy === a.id} onPress={() => run(a)} testID={`action-${a.id}`} />
        ))}
        <AppButton kind="secondary" icon="color-palette-outline" label="Style" onPress={() => router.push({ pathname: '/style/[id]', params: { id: note.id } })} testID="note-style" />
        <AppButton kind="secondary" icon="time-outline" label="History" onPress={() => router.push({ pathname: '/history/[id]', params: { id: note.id } })} testID="note-history" />
        <AppButton kind="secondary" icon="copy-outline" label="Template" onPress={() => router.push({ pathname: '/templates', params: { mode: 'apply', note: note.id } })} />
      </ScrollView>
      {block ? (
        <View style={styles.hint}>
          <Caption>Opened from search. Jumping to the exact line arrives with the editor.</Caption>
        </View>
      ) : null}
      <View style={styles.page}>
        <Page doc={doc} packId={note.stylePackId} />
      </View>
      <View style={styles.hint}>
        <Caption>Read-only for now: typing arrives with the editor (milestone M5).</Caption>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  page: { flex: 1, marginHorizontal: 12 },
  hint: { paddingHorizontal: 16, paddingVertical: 6 },
});
