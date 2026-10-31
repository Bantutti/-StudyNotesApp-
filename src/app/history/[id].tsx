/** History: the note's saved versions (newest first) with reason labels (plan F14). */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { relativeTime, useDataVersion, useStore, versionLabel } from '@/composition';
import { AppScreen, BodyText, EmptyState, ListRow, Surface } from '@/core/ui';
import { VERSIONS_KEPT, type VersionMeta } from '@/modules/store';

export default function History() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const version = useDataVersion();
  const [list, setList] = useState<VersionMeta[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      store.versions.list(String(id)).then((v) => {
        if (!alive) return;
        setList(v);
        setNow(Date.now());
      });
      return () => {
        alive = false;
      };
    }, [store, id, version]), // eslint-disable-line react-hooks/exhaustive-deps -- version triggers reloads
  );

  if (!list) return null;
  return (
    <AppScreen>
      <Surface>
        <BodyText muted>
          Versions are saved before Beautify, a style change, a template or a restore, and while you edit. The
          newest {VERSIONS_KEPT} stay on this phone.
        </BodyText>
      </Surface>
      {list.length === 0 ? (
        <EmptyState title="No versions yet" body="A version appears the first time you Beautify, change the style or edit for a while." />
      ) : (
        list.map((v) => (
          <ListRow
            key={v.id}
            testID={`version-${v.id}`}
            icon="time-outline"
            title={versionLabel(v.reason)}
            subtitle={v.title || undefined}
            trailing={relativeTime(v.created, now)}
            onPress={() => router.push({ pathname: '/version/[id]', params: { id: v.id, note: String(id) } })}
          />
        ))
      )}
    </AppScreen>
  );
}
