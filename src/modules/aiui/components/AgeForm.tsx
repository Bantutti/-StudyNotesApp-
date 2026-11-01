/**
 * The neutral age check (ALGORITHMS §1; Rey Nov 1; Q2 = A, Q3 = A).
 *
 * - "What year were you born?" with an EMPTY field (no default) and no
 *   mention of the cut-off before the answer.
 * - Boundary year only: the month (12 chips, none selected), then the day
 *   only if the month is this month.
 * - The year, month and day live ONLY in this component's state. When a
 *   result is reached, the state is cleared first and only adult yes/no is
 *   passed up. Nothing here is logged.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { t } from '@/core';
import { AppButton, BodyText, Caption, TextField, Title, useTheme } from '@/core/ui';

import { checkDay, checkMonth, checkYear, localDate, parseWhole, type AgeStep } from '../gate/ageRule';
import { Chip } from './parts';
import { ta } from '../strings';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Stage = 'year' | 'month' | 'day';

export function AgeForm(props: { onResult: (adult: boolean) => void; busy?: boolean; now?: () => number }) {
  const th = useTheme();
  const now = props.now ?? Date.now;
  const [stage, setStage] = useState<Stage>('year');
  const [yearText, setYearText] = useState('');
  const [month, setMonth] = useState<number | null>(null);
  const [dayText, setDayText] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** Clears every typed value, then reports only the result (§1.1). */
  const finish = (adult: boolean) => {
    setYearText('');
    setMonth(null);
    setDayText('');
    setStage('year');
    setError(null);
    props.onResult(adult);
  };

  const handle = (step: AgeStep) => {
    switch (step.kind) {
      case 'adult':
        return finish(true);
      case 'minor':
        return finish(false);
      case 'need_month':
        setError(null);
        return setStage('month');
      case 'need_day':
        setError(null);
        return setStage('day');
      case 'invalid':
        return setError(ta(step.field === 'year' ? 'ai.age.badYear' : step.field === 'month' ? 'ai.age.badMonth' : 'ai.age.badDay'));
    }
  };

  const year = parseWhole(yearText, 4);
  const today = () => localDate(now());

  return (
    <View style={{ gap: th.space.l }}>
      {stage === 'year' ? (
        <>
          <Title>{ta('ai.age.title')}</Title>
          <BodyText muted>{ta('ai.age.why')}</BodyText>
          <TextField
            label={ta('ai.age.yearLabel')}
            value={yearText}
            onChangeText={(v) => {
              setYearText(v.replace(/[^0-9]/g, '').slice(0, 4));
              setError(null);
            }}
            keyboardType="number-pad"
            maxLength={4}
            autoComplete="off"
            importantForAutofill="no"
            error={error}
            testID="ai-age-year"
          />
          <AppButton label={t('common.next')} onPress={() => handle(checkYear(year, today()))} disabled={!yearText || props.busy} testID="ai-age-next" />
        </>
      ) : null}
      {stage === 'month' ? (
        <>
          <Title>{ta('ai.age.monthTitle')}</Title>
          <View accessibilityRole="radiogroup" accessibilityLabel={ta('ai.age.monthTitle')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.space.s }}>
            {MONTHS.map((m, i) => (
              <Chip key={m} label={m} selected={month === i + 1} onPress={() => setMonth(i + 1)} testID={`ai-age-month-${i + 1}`} />
            ))}
          </View>
          {error ? <Caption color={th.dangerText}>{error}</Caption> : null}
          <AppButton
            label={t('common.next')}
            onPress={() => year !== null && handle(checkMonth(year, month, today()))}
            disabled={month === null || props.busy}
            testID="ai-age-next"
          />
        </>
      ) : null}
      {stage === 'day' ? (
        <>
          <Title>{ta('ai.age.dayTitle')}</Title>
          <TextField
            label={ta('ai.age.dayLabel')}
            value={dayText}
            onChangeText={(v) => {
              setDayText(v.replace(/[^0-9]/g, '').slice(0, 2));
              setError(null);
            }}
            keyboardType="number-pad"
            maxLength={2}
            autoComplete="off"
            importantForAutofill="no"
            error={error}
            testID="ai-age-day"
          />
          <AppButton
            label={t('common.next')}
            onPress={() => year !== null && month !== null && handle(checkDay(year, month, parseWhole(dayText, 2), today()))}
            disabled={!dayText || props.busy}
            testID="ai-age-next"
          />
        </>
      ) : null}
      <Caption>{ta('ai.age.privacy')}</Caption>
    </View>
  );
}
