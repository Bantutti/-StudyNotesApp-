/** Create (?subject=) or rename (?id=) a folder. */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useStore } from '@/composition';
import { t, userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, TextField } from '@/core/ui';

export default function FolderForm() {
  const { id, subject } = useLocalSearchParams<{ id?: string; subject?: string }>();
  const store = useStore();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    store.folders.get(id).then((f) => alive && f && setName(f.name));
    return () => {
      alive = false;
    };
  }, [store, id]);

  const save = async () => {
    try {
      if (id) await store.folders.rename(id, name);
      else await store.folders.create({ subject: subject ? subject : null, name });
      router.back();
    } catch (e) {
      setError(userMessage(e));
    }
  };

  return (
    <AppScreen>
      <Stack.Screen options={{ title: id ? 'Rename folder' : t('folders.new') }} />
      <TextField label="Folder name" value={name} onChangeText={setName} maxLength={80} placeholder="Week 1" autoFocus onSubmitEditing={save} returnKeyType="done" />
      {error ? <BodyText>{error}</BodyText> : null}
      <AppButton label={t('common.save')} onPress={save} disabled={!name.trim()} />
    </AppScreen>
  );
}
