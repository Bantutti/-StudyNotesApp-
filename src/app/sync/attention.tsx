/** Needs attention: conflicts to resolve, plus items that failed validation (ids only). */
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useServices, useStore, useSyncView } from '@/composition';
import { AppScreen, BodyText, EmptyState, ListRow, SectionHeader } from '@/core/ui';
import { listConflicts, type ConflictView } from '@/modules/sync';

const KIND: Record<string, string> = {
  edit_edit: 'Changed on two devices',
  remote_deleted: 'Deleted on another device',
  local_deleted: 'Edited on another device after you deleted it',
};

export default function Attention() {
  const store = useStore();
  const view = useSyncView();
  const { cloud } = useServices();
  const [items, setItems] = useState<ConflictView[]>([]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void listConflicts(store.sync).then((l) => alive && setItems(l));
      return () => {
        alive = false;
      };
    }, [store]),
  );
  const quarantined = view.kind === 'on' ? view.status.quarantined : 0;
  return (
    <AppScreen>
      <Stack.Screen options={{ title: 'Needs attention' }} />
      {items.length === 0 && quarantined === 0 ? <EmptyState title="All good" body="Nothing needs your attention." /> : null}
      {items.length ? <SectionHeader>Choose what to keep</SectionHeader> : null}
      {items.map(({ conflict, mine }) => (
        <ListRow
          key={`${conflict.tbl}:${conflict.id}`}
          icon={conflict.tbl === 'notes' ? 'document-text-outline' : 'albums-outline'}
          title={String(mine?.title ?? conflict.serverRow.title ?? '') || (conflict.tbl === 'notes' ? 'Untitled note' : conflict.tbl === 'cards' ? 'Card' : 'Recording')}
          subtitle={KIND[conflict.kind]}
          onPress={() => router.push({ pathname: '/sync/conflict', params: { tbl: conflict.tbl, id: conflict.id } })}
          testID="attention-conflict"
        />
      ))}
      {quarantined > 0 ? (
        <>
          <SectionHeader>Couldn’t sync</SectionHeader>
          <BodyText muted>
            {quarantined} item{quarantined === 1 ? '' : 's'} didn’t pass the safety checks and {quarantined === 1 ? 'was' : 'were'} kept out. Editing the item usually fixes it. Nothing was lost on this phone.
          </BodyText>
        </>
      ) : null}
      {cloud ? <ListRow icon="sync-outline" title="Sync now" onPress={() => void cloud.sync.syncNow()} /> : null}
    </AppScreen>
  );
}
