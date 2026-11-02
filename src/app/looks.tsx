/**
 * Your looks (P5): rename or delete the packs you made with Match a look.
 * Deleting moves notes and subjects that used the look to Pastel Highlight
 * (the default); the look is erased everywhere it was synced.
 */
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { deleteCustomPack, renameCustomPack, useAppData, usePackList, useServices } from '@/composition';
import { userMessage } from '@/core';
import { AppButton, AppScreen, Caption, EmptyState, SectionHeader, TextField } from '@/core/ui';
import { PackSwatch, swatchModel } from '@/modules/stylepacks';

function LookRow({ id, name }: { id: string; name: string }) {
  const { store, bus } = useAppData();
  const { packs } = useServices();
  const [value, setValue] = useState(name);
  const pack = packs.get(id);
  if (!pack) return null;
  const rename = async () => {
    try {
      await renameCustomPack(store, packs, id, value);
      bus.emit();
    } catch (e) {
      Alert.alert('Rename', userMessage(e));
    }
  };
  const remove = () =>
    Alert.alert('Delete this look?', 'Notes that use it will switch to Pastel Highlight. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCustomPack(store, packs, id);
            bus.emit();
          } catch (e) {
            Alert.alert('Delete', userMessage(e));
          }
        },
      },
    ]);
  return (
    <View style={{ gap: 8 }}>
      <PackSwatch m={swatchModel(pack, true)} />
      <TextField label="Name" value={value} onChangeText={setValue} maxLength={40} />
      <AppButton kind="secondary" icon="checkmark-outline" label="Save name" onPress={rename} disabled={value.trim() === name} />
      <AppButton kind="danger" icon="trash-outline" label="Delete look" onPress={remove} />
    </View>
  );
}

export default function YourLooks() {
  const { packs, customIds } = usePackList();
  const mine = packs.filter((p) => customIds.has(p.id));
  if (mine.length === 0) return <EmptyState title="No looks yet" body="Use Match a look in the + menu to make one from a photo." />;
  return (
    <AppScreen>
      <Caption>Looks you made from photos. They sync with your account when sync is on.</Caption>
      {mine.map((p) => (
        <View key={p.id} style={{ gap: 6 }}>
          <SectionHeader>{p.name}</SectionHeader>
          <LookRow id={p.id} name={p.name} />
        </View>
      ))}
    </AppScreen>
  );
}
