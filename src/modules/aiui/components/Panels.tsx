/**
 * Small panels: subject blocked, under 18, nothing to change, running,
 * errors. Plan §9.6 tone: short, friendly, specific, never blaming; one
 * next step. The under-18 panel explains once and doesn't nag (no badges,
 * no repeated prompts, no "ask a parent" pressure).
 */
import { ActivityIndicator, View } from 'react-native';

import { t } from '@/core';
import { AppButton, BodyText, Caption, Title, useTheme } from '@/core/ui';
import { PROVIDER_CATALOG, type Provider, type RunProgress } from '@/modules/ai';

import type { ErrorView } from '../flow/types';
import { progressText } from '../format';
import { ta } from '../strings';

export function BlockedPanel({ onClose }: { onClose: () => void }) {
  const th = useTheme();
  return (
    <View style={{ gap: th.space.l }}>
      <Title>{ta('ai.blocked.title')}</Title>
      <BodyText>{ta('ai.blocked.body')}</BodyText>
      <AppButton label={t('common.done')} onPress={onClose} testID="ai-blocked-ok" />
    </View>
  );
}

export function MinorPanel({ recheckAvailable, onClose, onRecheck }: { recheckAvailable: boolean; onClose: () => void; onRecheck: () => void }) {
  const th = useTheme();
  return (
    <View style={{ gap: th.space.l }} testID="ai-minor">
      <Title>{ta('ai.minor.title')}</Title>
      <BodyText>{ta('ai.minor.body')}</BodyText>
      <BodyText muted>{ta('ai.minor.lite')}</BodyText>
      <AppButton label={t('common.done')} onPress={onClose} testID="ai-minor-ok" />
      {recheckAvailable ? <AppButton kind="secondary" label={ta('ai.minor.recheck')} onPress={onRecheck} testID="ai-minor-recheck" /> : null}
    </View>
  );
}

export function RunningPanel({ progress, provider, onCancel }: { progress: RunProgress | null; provider: Provider; onCancel: () => void }) {
  const th = useTheme();
  return (
    <View style={{ gap: th.space.l, alignItems: 'stretch' }}>
      <ActivityIndicator color={th.accent} accessibilityLabel={ta('ai.run.working')} />
      <BodyText center>{progressText(progress, provider)}</BodyText>
      <AppButton kind="secondary" label={t('common.cancel')} onPress={onCancel} testID="ai-cancel" />
    </View>
  );
}

export function EmptyPanel({ provider, reported, onClose, onReport }: { provider: Provider; reported: boolean; onClose: () => void; onReport: () => void }) {
  const th = useTheme();
  return (
    <View style={{ gap: th.space.l }}>
      <Title>{ta('ai.empty.title')}</Title>
      <BodyText>{ta('ai.empty.body', { provider: PROVIDER_CATALOG[provider].label })}</BodyText>
      <AppButton label={t('common.done')} onPress={onClose} testID="ai-empty-ok" />
      {reported ? <Caption>{ta('ai.report.saved')}</Caption> : <AppButton kind="plain" icon="flag-outline" label={ta('ai.report.button')} onPress={onReport} />}
    </View>
  );
}

/** Label for the error's one next step. */
function nextLabel(e: ErrorView): string {
  switch (e.next) {
    case 'retry':
      return ta('ai.error.retry');
    case 'replace_key':
      return ta('ai.error.replaceKey');
    case 'switch_provider':
      return ta('ai.error.switch', { provider: e.switchTo ? PROVIDER_CATALOG[e.switchTo].label : '' });
    case 'beautify_lite':
      return ta('ai.error.useLite');
    case 'select_part':
    case 'ok':
      return t('common.done');
  }
}

export function ErrorPanel({ error, onNext, onClose }: { error: ErrorView; onNext: () => void; onClose: () => void }) {
  const th = useTheme();
  const terminal = error.next === 'ok' || error.next === 'select_part' || error.next === 'beautify_lite';
  return (
    <View style={{ gap: th.space.l }}>
      <Title>{ta('ai.error.title')}</Title>
      <BodyText>{error.message}</BodyText>
      {error.next === 'beautify_lite' ? <BodyText muted>{ta('ai.minor.lite')}</BodyText> : null}
      <AppButton label={nextLabel(error)} onPress={onNext} testID="ai-error-next" />
      {!terminal ? <AppButton kind="secondary" label={t('common.cancel')} onPress={onClose} /> : null}
    </View>
  );
}
