/**
 * Note editor (plan 9.4).
 * Top: title, mode switch Type · Draw (P4b placeholder) · Style, note
 * actions. Middle: the TipTap page in its pack. Bottom: the keyboard
 * toolbar with the P3b sparkle slot.
 * Saving: autosave (1 s after typing stops, at least every 5 s, flushed on
 * background/leave), "every 10 minutes" and "on leave" versions, actions run
 * through runEditorAction with an editor-backed host and exact Undo.
 * Links open outside the app. ?block=<id> (from search) scrolls to the line.
 * Keyboard placement on Android is UNVERIFIED on real phones (see
 * TESTING_ON_DEVICE, Typing diagnostics).
 */
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  createNoteSession,
  displayTitle,
  rememberOpenedNote,
  useAppData,
  usePackFaces,
  useServices,
} from '@/composition';
import { AppError, countWords, errorCode, outline, t, tCount, userMessage, type OutlineItem } from '@/core';
import { Banner, Caption, IconButton, Spinner, useTheme } from '@/core/ui';
import { EditorView, type EditorCommand, type EditorHandle, type EditorHost, type EditorState } from '@/modules/editor';
import type { Note } from '@/modules/store';
import { EditorToolbar } from '@/screens/EditorToolbar';
import { useEditorActionRunner } from '@/screens/editorActionHooks';
import { BlockMenuSheet, InfoSheet, LinkSheet } from '@/screens/EditorSheets';

type Sheet = 'block' | 'link' | 'info' | null;

export default function NoteScreen() {
  const th = useTheme();
  const { id: rawId, block } = useLocalSearchParams<{ id: string; block?: string }>();
  const id = String(rawId);
  const { store, showActionUndo, showUndo } = useAppData();
  const { editorActions, ids, links, logger } = useServices();

  const [note, setNote] = useState<Note | null | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [edState, setEdState] = useState<EditorState | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [info, setInfo] = useState<{ words: number; items: OutlineItem[] }>({ words: 0, items: [] });
  const [focusMode, setFocusMode] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const [session] = useState(() => createNoteSession({ store, noteId: id, onBanner: setBanner }));
  useEffect(() => () => session.dispose(), [session]);
  // flush/leave save what is only in the WebView so far (the last word, a composition in progress).
  useEffect(() => {
    session.setLiveSource(() => editor.current?.requestDoc() ?? Promise.resolve(null));
  }, [session]);

  const { pack, faces } = usePackFaces(note?.stylePackId ?? '');

  // Load on focus. Coming back from History, Style or Template, reload when the stored note changed.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      store.notes.get(id).then((n) => {
        if (!alive) return;
        if (!n || n.deleted) return setNote(null);
        if (session.changedElsewhere(n.updated)) {
          session.shown(n.document);
          editor.current?.load(n.document);
        } else if (!session.latestDoc) session.shown(n.document);
        session.seen(n.updated);
        setNote(n);
        setTitle(n.title);
        void rememberOpenedNote(store, n.id);
      });
      return () => {
        alive = false;
        void session.leave().catch(() => logger.warn('note.leave_save_failed'));
      };
    }, [store, id, session, logger]),
  );

  // App to the background: save immediately.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') void session.flush();
    });
    return () => sub.remove();
  }, [session]);

  const host = useMemo<EditorHost>(
    () => ({
      getDocument: async () => {
        await session.flush();
        // The live document, or a rejection: an action must never run on (and save) a stand-in.
        const handle = editor.current;
        if (handle) return handle.requestDoc();
        if (session.latestDoc) return session.latestDoc;
        throw new AppError('unsupported', 'The editor is not ready yet. Try again.');
      },
      getSelection: async () => {
        const sel = (await editor.current?.requestSelection()) ?? [];
        return sel.length ? sel : null;
      },
      showDocument: (d) => {
        session.shown(d);
        editor.current?.load(d);
      },
    }),
    [session],
  );

  const runner = useEditorActionRunner({
    store,
    ids,
    host,
    noteId: id,
    onDone: (action, outcome) => {
      if (outcome) showActionUndo(outcome.message, outcome.undo);
      else Alert.alert(action.label, 'Nothing to change here.');
    },
    // P3b: closing the AI panel is a cancel, not an error (core: 'cancelled' shows no message).
    onError: (action, e) => void (errorCode(e) !== 'cancelled' && Alert.alert(action.label, userMessage(e))),
  });
  const actionContext = useMemo(
    () => (note ? { noteId: note.id, subjectId: note.subject, title: note.title, stylePackId: note.stylePackId, selection: null } : null),
    [note],
  );

  if (note === undefined) return <Spinner />;
  if (note === null) return <Caption>This note no longer exists.</Caption>;

  // EditorView sends pack, fonts and readyDoc on every 'ready' (also after a WebView restart).
  const onReady = () => {
    if (block) setTimeout(() => editor.current?.scrollToBlock(block), 350);
  };

  const command = (name: EditorCommand, arg?: string) => editor.current?.command(name, arg);

  const saveTitle = async () => {
    if (title === note.title) return;
    try {
      const r = await store.notes.save(id, { title });
      session.seen(r.note.updated);
      setNote({ ...note, title: r.note.title });
    } catch (e) {
      Alert.alert('Title', userMessage(e));
      setTitle(note.title);
    }
  };

  const openInfo = async () => {
    const d = (await editor.current?.requestDoc().catch(() => null)) ?? session.latestDoc ?? note.document;
    setInfo({ words: countWords(d), items: outline(d) });
    setSheet('info');
  };

  const go = async (path: '/style/[id]' | '/history/[id]') => {
    await session.flush();
    router.push({ pathname: path, params: { id } });
  };
  const addTemplate = async () => {
    await session.flush();
    router.push({ pathname: '/templates', params: { mode: 'apply', note: id } });
  };
  const deleteNote = () =>
    Alert.alert('Delete this note?', 'You can undo for a few seconds.', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await session.flush();
          session.dispose();
          const token = await store.notes.remove([id]);
          router.back();
          showUndo(tCount('notes.deleted', 1), token);
        },
      },
    ]);

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: th.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen
        options={{
          title: displayTitle({ ...note, title }),
          headerRight: () => (
            <View style={styles.headerButtons}>
              <IconButton icon="time-outline" label="History" onPress={() => void go('/history/[id]')} testID="note-history" />
              <IconButton icon="information-circle-outline" label="Note info and outline" onPress={() => void openInfo()} />
            </View>
          ),
        }}
      />
      {focusMode ? null : (
        <>
          <TextInput
            value={title}
            onChangeText={setTitle}
            onEndEditing={() => void saveTitle()}
            onBlur={() => void saveTitle()}
            placeholder="Title"
            placeholderTextColor={th.muted}
            maxLength={200}
            accessibilityLabel="Note title"
            returnKeyType="done"
            style={[styles.title, { color: th.text }]}
            testID="note-title"
          />
          <View style={styles.modes}>
            <Mode label={t('editor.mode.type')} active onPress={() => undefined} />
            <Mode label={t('editor.mode.draw')} onPress={() => Alert.alert(t('editor.mode.draw'), t('editor.drawSoon'))} />
            <Mode label={t('editor.mode.style')} onPress={() => void go('/style/[id]')} testID="note-style" />
            <View style={styles.flex} />
            <IconButton icon="copy-outline" label="Add a template" onPress={() => void addTemplate()} />
            <IconButton icon="trash-outline" label="Delete note" onPress={deleteNote} />
          </View>
        </>
      )}
      {banner ? (
        <View style={styles.banner}>
          <Banner>{banner}</Banner>
        </View>
      ) : null}
      <View style={[styles.page, { borderColor: th.line }]}>
        <EditorView
          ref={editor}
          logger={logger}
          pack={pack}
          faces={faces}
          getDoc={() => session.readyDoc(note.document)}
          onReady={onReady}
          onChange={(d) => session.edited(d)}
          onState={setEdState}
          onOpenLink={(href) => void links(href)}
          onBridgeError={(code) => {
            if (code === 'invalid_doc') setBanner('Your last change could not be checked, so it was not saved. Try undo, or copy the text to a new note.');
            if (code === 'too_large') setBanner('This note is too long to save. Split it into two notes.');
          }}
        />
      </View>
      <View style={styles.focusRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={focusMode ? 'Leave focus mode' : 'Focus mode'} onPress={() => setFocusMode((f) => !f)} hitSlop={8}>
          <Text style={{ color: th.muted, fontSize: th.type.caption }}>{focusMode ? 'Show title and modes' : 'Focus mode'}</Text>
        </Pressable>
      </View>
      <EditorToolbar
        state={edState}
        pack={pack}
        registry={editorActions}
        actionContext={actionContext}
        busyAction={runner.busy}
        onCommand={command}
        onAction={(a) => void runner.run(a)}
        onBlockMenu={() => setSheet('block')}
        onLink={() => setSheet('link')}
      />
      <BlockMenuSheet visible={sheet === 'block'} onClose={() => setSheet(null)} onCommand={command} />
      <LinkSheet visible={sheet === 'link'} onClose={() => setSheet(null)} onApply={(href) => command('link', href)} onRemove={() => command('unlink')} />
      <InfoSheet visible={sheet === 'info'} onClose={() => setSheet(null)} words={info.words} items={info.items} onJump={(b) => editor.current?.scrollToBlock(b)} />
    </KeyboardAvoidingView>
  );
}

function Mode({ label, active, onPress, testID }: { label: string; active?: boolean; onPress: () => void; testID?: string }) {
  const th = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.mode, { borderRadius: th.radius.chip, backgroundColor: active ? th.primary.fill : th.surface, borderColor: th.line }]}
    >
      <Text style={{ color: active ? th.primary.text : th.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  headerButtons: { flexDirection: 'row' },
  title: { fontSize: 22, fontWeight: '700', paddingHorizontal: 16, paddingTop: 8, minHeight: 44 },
  modes: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 6 },
  mode: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1 },
  banner: { paddingHorizontal: 12, paddingBottom: 6 },
  page: { flex: 1, marginHorizontal: 8, borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  focusRow: { alignItems: 'flex-end', paddingHorizontal: 14, paddingVertical: 2 },
});
