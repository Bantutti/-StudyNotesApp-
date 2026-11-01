/** Create or edit a subject: name, colour, exam date, default look. */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatExamDate, isP1Pack, parseExamDate, useServices, useStore } from '@/composition';
import { t, userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, ListRow, SectionHeader, SUBJECT_COLORS, Swatch, TextField } from '@/core/ui';
import { P1_PACK_IDS } from '@/modules/stylepacks';

const COLOR_NAMES = ['Blue', 'Pink', 'Green', 'Amber', 'Violet', 'Teal', 'Orange', 'Slate'];

export default function SubjectForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const store = useStore();
  const { packs, templates } = useServices();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(SUBJECT_COLORS[0]);
  const [exam, setExam] = useState('');
  const [pack, setPack] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    store.subjects.get(id).then((s) => {
      if (!alive || !s) return;
      setName(s.name);
      setColor(s.color);
      const next = s.examDates.find((d) => d >= Date.now() - 86_400_000);
      setExam(next ? formatExamDate(next) : '');
      setPack(s.defaultPack && isP1Pack(s.defaultPack) ? s.defaultPack : null);
      setTemplate(s.defaultTemplate && templates.get(s.defaultTemplate) ? s.defaultTemplate : null);
    });
    return () => {
      alive = false;
    };
  }, [store, id, templates]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const examDate = parseExamDate(exam, Date.now());
      const fields = { name, color, examDates: examDate ? [examDate] : [], defaultPack: pack, defaultTemplate: template };
      if (id) await store.subjects.update(id, fields);
      else await store.subjects.create(fields);
      router.back();
    } catch (e) {
      setError(userMessage(e));
      setBusy(false);
    }
  };

  return (
    <AppScreen>
      <Stack.Screen options={{ title: id ? 'Edit subject' : t('subjects.new') }} />
      <TextField label={t('subject.name')} value={name} onChangeText={setName} maxLength={80} placeholder="Biology" autoFocus={!id} testID="form-subject-name" />
      <BodyText>{t('subject.color')}</BodyText>
      <View style={styles.swatches} accessibilityRole="radiogroup">
        {SUBJECT_COLORS.map((c, i) => (
          <Swatch key={c} color={`#${c}`} label={COLOR_NAMES[i] ?? c} selected={c === color.toUpperCase()} onPress={() => setColor(c)} />
        ))}
      </View>
      <TextField label={t('subject.examDate')} value={exam} onChangeText={setExam} placeholder="2026-12-15" keyboardType="numbers-and-punctuation" maxLength={10} />
      <SectionHeader>Default look for this subject</SectionHeader>
      <ListRow title="Same as my default" icon={pack === null ? 'radio-button-on' : 'radio-button-off'} onPress={() => setPack(null)} />
      {P1_PACK_IDS.map((p) => (
        <ListRow key={p} title={packs.getOrDefault(p).name} icon={pack === p ? 'radio-button-on' : 'radio-button-off'} onPress={() => setPack(p)} />
      ))}
      <SectionHeader>New notes start from</SectionHeader>
      <ListRow title="A blank page" icon={template === null ? 'radio-button-on' : 'radio-button-off'} onPress={() => setTemplate(null)} />
      {templates.list().map((tpl) => (
        <ListRow key={tpl.id} title={tpl.name} subtitle={tpl.description} icon={template === tpl.id ? 'radio-button-on' : 'radio-button-off'} onPress={() => setTemplate(tpl.id)} />
      ))}
      {error ? <BodyText>{error}</BodyText> : null}
      <AppButton label={t('common.save')} onPress={save} disabled={!name.trim()} busy={busy} testID="form-subject-save" />
    </AppScreen>
  );
}

const styles = StyleSheet.create({ swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 } });
