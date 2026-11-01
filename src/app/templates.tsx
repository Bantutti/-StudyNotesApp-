/**
 * Template picker. ?mode=new (with optional subject/folder) creates a note;
 * ?mode=apply&note=<id> adds the template to an existing note (a version is
 * saved first, existing blocks keep their ids).
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { applyTemplateToNote, createNoteIn, useStore, useTemplateDeps } from '@/composition';
import { t, userMessage } from '@/core';
import { AppScreen, BodyText, ListRow, type IconName } from '@/core/ui';

export default function TemplatePicker() {
  const p = useLocalSearchParams<{ mode?: string; subject?: string; folder?: string; note?: string }>();
  const store = useStore();
  const deps = useTemplateDeps();
  const [busy, setBusy] = useState(false);
  const apply = p.mode === 'apply' && !!p.note;

  const pick = async (templateId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (apply) {
        await applyTemplateToNote(store, String(p.note), templateId, deps);
        router.back();
      } else {
        const n = await createNoteIn(store, { subject: p.subject || null, folder: p.folder || null }, { templateId }, deps);
        router.dismissTo('/home');
        router.push({ pathname: '/note/[id]', params: { id: n.id } });
      }
    } catch (e) {
      Alert.alert(t('notes.fromTemplate'), userMessage(e));
      setBusy(false);
    }
  };

  return (
    <AppScreen>
      <Stack.Screen options={{ title: apply ? 'Add a template' : t('notes.fromTemplate') }} />
      {apply ? <BodyText muted>The template’s sections are added below your note. A version is saved first, so you can go back.</BodyText> : null}
      {deps.templates.list().map((tpl) => (
        <ListRow
          key={tpl.id}
          testID={`template-${tpl.id}`}
          icon={tpl.icon as IconName}
          title={tpl.name}
          subtitle={tpl.description}
          onPress={() => pick(tpl.id)}
        />
      ))}
    </AppScreen>
  );
}
