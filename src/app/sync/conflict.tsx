/**
 * Conflict resolver (plan F1, Q5): "This note changed on two devices. Choose
 * what to keep." Both versions as plain text by block, changes marked.
 * Phones: two tabs; wide screens: side by side. Both versions are saved in
 * History ("Before sync merge") before any choice.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, useWindowDimensions, View } from 'react-native';

import { previewPair, useServices, useStore, type PreviewLine } from '@/composition';
import { userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, Caption, Segmented, Surface, Title, useTheme } from '@/core/ui';
import { SYNC_TABLES, type SyncTable } from '@/modules/store';
import { listConflicts, type ConflictChoice, type ConflictView } from '@/modules/sync';

const MARK_LABEL: Record<PreviewLine['mark'], string> = { same: '', changed: 'Changed', added: 'Only here', removed: 'Only there' };

function Column({ title, deleted, lines }: { title: string; deleted: boolean; lines: PreviewLine[] }) {
  const th = useTheme();
  return (
    <Surface style={{ flex: 1, gap: th.space.xs }}>
      <Text style={{ color: th.text, fontWeight: '700', fontSize: th.type.body }}>{deleted ? 'Deleted' : title || 'Untitled'}</Text>
      {lines.map((l) => (
        <View key={l.key} style={l.mark === 'same' ? null : { borderLeftWidth: 3, borderLeftColor: th.accentText, paddingLeft: th.space.xs }}>
          {l.mark !== 'same' ? <Caption>{MARK_LABEL[l.mark]}</Caption> : null}
          <Text style={{ color: th.text, fontSize: th.type.body }}>{l.text}</Text>
        </View>
      ))}
    </Surface>
  );
}

export default function ConflictScreen() {
  const { tbl, id } = useLocalSearchParams<{ tbl?: string; id?: string }>();
  const store = useStore();
  const { cloud } = useServices();
  const { width } = useWindowDimensions();
  const [item, setItem] = useState<ConflictView | null>(null);
  const [tab, setTab] = useState<'mine' | 'theirs'>('mine');
  const [busy, setBusy] = useState(false);
  const table = (SYNC_TABLES as readonly string[]).includes(tbl ?? '') ? (tbl as SyncTable) : null;

  useEffect(() => {
    let alive = true;
    void listConflicts(store.sync).then((l) => alive && setItem(l.find((x) => x.conflict.tbl === table && x.conflict.id === id) ?? null));
    return () => {
      alive = false;
    };
  }, [store, table, id]);

  if (!cloud || !table || !id || !item) return <AppScreen><BodyText>This conflict was already resolved.</BodyText></AppScreen>;
  const { conflict, mine } = item;
  const p = previewPair(mine, conflict.serverRow);
  const choose = async (c: ConflictChoice) => {
    setBusy(true);
    try {
      await cloud.sync.resolve(table, id, c);
      router.back();
    } catch (e) {
      Alert.alert('Conflict', userMessage(e));
      setBusy(false);
    }
  };
  const remoteDeleted = conflict.kind === 'remote_deleted';
  const localDeleted = conflict.kind === 'local_deleted';
  const wide = width >= 700;
  return (
    <AppScreen>
      <Stack.Screen options={{ title: 'Choose what to keep' }} />
      <Title>
        {remoteDeleted ? 'Deleted on another device' : localDeleted ? 'Edited on another device' : 'This note changed on two devices. Choose what to keep.'}
      </Title>
      <Caption>Both versions are saved in History first, so you can change your mind later.</Caption>
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Column {...p.mine} />
          <Column {...p.theirs} />
        </View>
      ) : (
        <>
          <Segmented label="Version" value={tab} options={[{ value: 'mine', label: 'This phone' }, { value: 'theirs', label: 'Other device' }]} onChange={setTab} />
          <Column {...(tab === 'mine' ? p.mine : p.theirs)} />
        </>
      )}
      {remoteDeleted ? (
        <>
          <AppButton label="Restore mine" busy={busy} onPress={() => void choose('mine')} testID="conflict-mine" />
          <AppButton label="Delete it" kind="danger" onPress={() => void choose('other')} testID="conflict-other" />
        </>
      ) : localDeleted ? (
        <>
          <AppButton label="Keep it deleted" busy={busy} onPress={() => void choose('mine')} testID="conflict-mine" />
          <AppButton label="Restore the other version" kind="secondary" onPress={() => void choose('other')} testID="conflict-other" />
        </>
      ) : (
        <>
          <AppButton label="Keep mine" busy={busy} onPress={() => void choose('mine')} testID="conflict-mine" />
          <AppButton label="Keep other" kind="secondary" onPress={() => void choose('other')} testID="conflict-other" />
          {table === 'notes' ? <AppButton label="Keep both" kind="secondary" onPress={() => void choose('both')} testID="conflict-both" /> : null}
        </>
      )}
    </AppScreen>
  );
}
