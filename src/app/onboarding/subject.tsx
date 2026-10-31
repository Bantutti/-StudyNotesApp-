/** Add your first subject (name, colour, optional exam date), then open the Sample note. */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { finishOnboarding, parseExamDate, skipOnboarding, useStore } from '@/composition';
import { t, userMessage } from '@/core';
import { AppButton, AppScreen, BodyText, SUBJECT_COLORS, Swatch, TextField, Title } from '@/core/ui';
import { DEFAULT_PACK_ID } from '@/modules/stylepacks';

const COLOR_NAMES = ['Blue', 'Pink', 'Green', 'Amber', 'Violet', 'Teal', 'Orange', 'Slate'];

export default function FirstSubject() {
  const { pack } = useLocalSearchParams<{ pack?: string }>();
  const store = useStore();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(SUBJECT_COLORS[0]);
  const [exam, setExam] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const examDate = parseExamDate(exam, Date.now());
      const noteId = await finishOnboarding(store, { packId: pack ?? DEFAULT_PACK_ID, subject: { name, color, examDate } });
      router.replace('/home');
      router.push({ pathname: '/note/[id]', params: { id: noteId } });
    } catch (e) {
      setError(userMessage(e));
      setBusy(false);
    }
  };
  const skip = async () => {
    await skipOnboarding(store, pack);
    router.replace('/home');
  };

  return (
    <AppScreen edges={['top', 'bottom', 'left', 'right']}>
      <Title size="largeTitle">{t('subject.first.title')}</Title>
      <BodyText muted>{t('subject.first.body')}</BodyText>
      <TextField
        label={t('subject.name')}
        value={name}
        onChangeText={setName}
        maxLength={80}
        placeholder="Biology"
        autoFocus
        returnKeyType="done"
        testID="subject-name"
      />
      <BodyText>{t('subject.color')}</BodyText>
      <View style={styles.swatches} accessibilityRole="radiogroup">
        {SUBJECT_COLORS.map((c, i) => (
          <Swatch key={c} color={`#${c}`} label={COLOR_NAMES[i] ?? c} selected={c === color} onPress={() => setColor(c)} />
        ))}
      </View>
      <TextField label={t('subject.examDate')} value={exam} onChangeText={setExam} placeholder="2026-12-15" keyboardType="numbers-and-punctuation" maxLength={10} testID="subject-exam" />
      {error ? <BodyText>{error}</BodyText> : null}
      <AppButton label={t('subject.create')} onPress={create} disabled={!name.trim()} busy={busy} testID="subject-create" />
      <AppButton kind="plain" label={t('common.skip')} onPress={skip} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({ swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 } });
