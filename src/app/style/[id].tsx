/**
 * Style sheet (plan 9.3 / 9.4): THIS note shown live in its look, above a
 * grid of every look (13 built-in plus the student's own, P5). Tap to apply
 * (a version is saved first; content and block ids never change), use it for
 * the subject or for new notes, or add a template.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { applyPackToNote, setSubjectPack, useAppData, usePackFaces, usePackList } from '@/composition';
import { userMessage, type NoteDoc } from '@/core';
import { AppButton, AppScreen, Caption, SectionHeader } from '@/core/ui';
import { PagePreview } from '@/modules/editor';
import type { Note } from '@/modules/store';
import { PackPicker } from '@/modules/stylepacks';

/** The note itself, live, in the look it has now (one WebView; the grid below is native swatches, P5 Q9). */
function LivePreview({ id, doc }: { id: string; doc: NoteDoc }) {
  const { pack, faces } = usePackFaces(id);
  return <PagePreview doc={doc} pack={pack} faces={faces ?? []} height={240} zoom={0.6} label={`${pack.name} preview of this note`} />;
}

export default function StyleSheetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, bus } = useAppData();
  const [note, setNote] = useState<Note | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { packs, customIds } = usePackList();

  useEffect(() => {
    let alive = true;
    store.notes.get(String(id)).then((n) => alive && setNote(n && !n.deleted ? n : null));
    return () => {
      alive = false;
    };
  }, [store, id]);

  if (!note) return null;

  const choose = async (packId: string) => {
    try {
      if (await applyPackToNote(store, note.id, packId)) {
        setNote({ ...note, stylePackId: packId });
        bus.emit();
        setMsg('Look changed. The old look is saved in History.');
      }
    } catch (e) {
      Alert.alert('Style', userMessage(e));
    }
  };
  const forSubject = async () => {
    if (!note.subject) return;
    await setSubjectPack(store, note.subject, note.stylePackId);
    setMsg('New notes in this subject will use this look.');
  };
  const forNew = async () => {
    await store.settings.update({ defaultPack: note.stylePackId });
    setMsg('New notes will use this look.');
  };

  return (
    <AppScreen>
      <SectionHeader>Look</SectionHeader>
      <LivePreview id={note.stylePackId} doc={note.document} />
      <PackPicker packs={packs} customIds={customIds} selected={note.stylePackId} onSelect={choose} testIDPrefix="style" />
      <AppButton kind="secondary" icon="color-palette-outline" label="Match a look from a photo" onPress={() => router.push({ pathname: '/match', params: { note: note.id } })} testID="style-match" />
      {customIds.size > 0 ? <AppButton kind="plain" icon="create-outline" label="Rename or delete your looks" onPress={() => router.push('/looks')} /> : null}
      {msg ? <Caption>{msg}</Caption> : null}
      {note.subject ? <AppButton kind="secondary" icon="albums-outline" label="Use this look for the subject" onPress={forSubject} /> : null}
      <AppButton kind="secondary" icon="star-outline" label="Use this look for new notes" onPress={forNew} />
      <SectionHeader>Template</SectionHeader>
      <AppButton
        kind="secondary"
        icon="copy-outline"
        label="Add a template to this note"
        onPress={() => router.push({ pathname: '/templates', params: { mode: 'apply', note: note.id } })}
      />
    </AppScreen>
  );
}
