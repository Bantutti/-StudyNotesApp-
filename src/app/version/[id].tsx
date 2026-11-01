/** Preview one version in its own pack, then Restore (a "Before restore" version is saved first). */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { relativeTime, usePackFaces, useAppData, versionLabel } from '@/composition';
import { userMessage } from '@/core';
import { AppButton, Caption, Spinner, useTheme } from '@/core/ui';
import { PagePreview } from '@/modules/editor';
import type { Version } from '@/modules/store';

function Page({ v }: { v: Version }) {
  const { pack, faces } = usePackFaces(v.stylePackId);
  return <PagePreview doc={v.document} pack={pack} faces={faces ?? []} zoom={1} label="Version preview" scrollable />;
}

export default function VersionPreview() {
  const th = useTheme();
  const { id, note } = useLocalSearchParams<{ id: string; note: string }>();
  const { store, bus } = useAppData();
  const [v, setV] = useState<Version | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    store.versions
      .get(String(id))
      .then((x) => alive && setV(x))
      .catch(() => alive && setV(null));
    return () => {
      alive = false;
    };
  }, [store, id]);

  if (v === undefined) return <Spinner />;
  if (v === null) return <Caption>This version no longer exists.</Caption>;

  const restore = () =>
    Alert.alert('Restore this version?', 'Your current note is saved in History first, so you can switch back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        onPress: async () => {
          setBusy(true);
          try {
            await store.versions.restore(String(note), v.id);
            bus.emit();
            router.dismissTo({ pathname: '/note/[id]', params: { id: String(note) } });
          } catch (e) {
            Alert.alert('Restore', userMessage(e));
            setBusy(false);
          }
        },
      },
    ]);

  return (
    <View style={[styles.fill, { backgroundColor: th.bg }]}>
      <Stack.Screen options={{ title: versionLabel(v.reason) }} />
      <View style={styles.meta}>
        <Caption>
          {relativeTime(v.created, now)}
          {v.title ? ` · ${v.title}` : ''}
        </Caption>
      </View>
      <View style={styles.page}>
        <Page v={v} />
      </View>
      <View style={styles.actions}>
        <AppButton label="Restore this version" icon="refresh-outline" onPress={restore} busy={busy} testID="version-restore" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  meta: { paddingHorizontal: 16, paddingVertical: 8 },
  page: { flex: 1, marginHorizontal: 12 },
  actions: { padding: 16 },
});
