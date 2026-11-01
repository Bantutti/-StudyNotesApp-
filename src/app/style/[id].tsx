/**
 * Style sheet (plan 9.3 / 9.4): every look shown on THIS note, tap to apply
 * (a version is saved first; content and block ids never change), use it for
 * the subject or for new notes, or add a template.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { applyPackToNote, setSubjectPack, useAppData, usePackFaces } from '@/composition';
import { userMessage, type NoteDoc } from '@/core';
import { AppButton, AppScreen, BodyText, Caption, Icon, SectionHeader, useTheme } from '@/core/ui';
import { PagePreview } from '@/modules/editor';
import type { Note } from '@/modules/store';
import { P1_PACK_IDS } from '@/modules/stylepacks';

function PackChoice({ id, doc, selected, onPress }: { id: string; doc: NoteDoc; selected: boolean; onPress: () => void }) {
  const th = useTheme();
  const { pack, faces } = usePackFaces(id);
  return (
    <Pressable
      testID={`style-${id}`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${pack.name}. ${pack.meta.bestFor}.`}
      onPress={onPress}
      style={[styles.card, { borderColor: selected ? th.accent : th.line, backgroundColor: th.surface, borderRadius: th.radius.card }]}
    >
      <PagePreview doc={doc} pack={pack} faces={faces ?? []} height={200} zoom={0.6} label={`${pack.name} preview of this note`} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <BodyText>{pack.name}</BodyText>
          <Caption>{pack.meta.bestFor}</Caption>
        </View>
        {selected ? <Icon name="checkmark-circle" size={28} color={th.accent} /> : null}
      </View>
    </Pressable>
  );
}

export default function StyleSheetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, bus } = useAppData();
  const [note, setNote] = useState<Note | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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
      {P1_PACK_IDS.map((p) => (
        <PackChoice key={p} id={p} doc={note.document} selected={note.stylePackId === p} onPress={() => choose(p)} />
      ))}
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

const styles = StyleSheet.create({
  card: { borderWidth: 2, padding: 8, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingBottom: 4 },
  flex: { flex: 1 },
});
