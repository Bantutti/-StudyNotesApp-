/**
 * "Report this AI result" (Q10 = A): a reason chip and an optional short
 * comment, saved ONLY on this phone. Nothing is sent; the screen says so.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { t } from '@/core';
import { AppButton, BodyText, Caption, TextField, Title, useTheme } from '@/core/ui';

import { REPORT_COMMENT_MAX, REPORT_REASONS, type ReportReason } from '../gate/reportsStore';
import { Chip } from './parts';
import { ta } from '../strings';

const REASON_KEYS = {
  wrong: 'ai.report.wrong',
  harmful: 'ai.report.harmful',
  changed_meaning: 'ai.report.changedMeaning',
  broke_format: 'ai.report.brokeFormat',
  other: 'ai.report.other',
} as const;

export function ReportStep(props: { busy: boolean; onSubmit: (reason: ReportReason, comment: string) => void; onCancel: () => void }) {
  const th = useTheme();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  return (
    <View style={{ gap: th.space.l }}>
      <Title>{ta('ai.report.title')}</Title>
      <BodyText muted>{ta('ai.report.intro')}</BodyText>
      <View accessibilityRole="radiogroup" accessibilityLabel={ta('ai.report.title')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.space.s }}>
        {REPORT_REASONS.map((r) => (
          <Chip key={r} label={ta(REASON_KEYS[r])} selected={reason === r} onPress={() => setReason(r)} testID={`ai-report-${r}`} />
        ))}
      </View>
      <TextField
        label={ta('ai.report.comment')}
        value={comment}
        onChangeText={(v) => setComment(v.slice(0, REPORT_COMMENT_MAX))}
        maxLength={REPORT_COMMENT_MAX}
        multiline
        testID="ai-report-comment"
      />
      <Caption>{`${comment.length} / ${REPORT_COMMENT_MAX}`}</Caption>
      <AppButton label={ta('ai.report.save')} onPress={() => reason && props.onSubmit(reason, comment)} disabled={!reason} busy={props.busy} testID="ai-report-save" />
      <AppButton kind="secondary" label={t('common.cancel')} onPress={props.onCancel} disabled={props.busy} />
      <Caption>{ta('ai.report.local')}</Caption>
    </View>
  );
}
