/**
 * Consent before the first send to a provider (Plan F5 and Flow 4; Apple App
 * Review Guideline 5.1.2(i): say where personal data goes, including to
 * third-party AI, and get explicit permission).
 *
 * Shows every field of the provider's catalog `consent` block plus its data
 * use and (for Mistral) the training opt-out steps. The "yes" is stored per
 * provider with the consent version; a new version asks again.
 */
import { View } from 'react-native';

import { AppButton, Caption, Title, useTheme } from '@/core/ui';
import { consentBlock, PROVIDER_CATALOG, type ConsentKind, type Provider } from '@/modules/ai';

import type { AiScreenPorts } from '../ports';
import { Field, LinkButton, Notice } from './parts';
import { ta } from '../strings';

export function ConsentStep(props: {
  provider: Provider;
  /** Which data the "yes" covers. Defaults to note text; P5 passes 'image' for photos. */
  kind?: ConsentKind;
  busy: boolean;
  ports: AiScreenPorts;
  onAnswer: (yes: boolean) => void;
}) {
  const th = useTheme();
  const info = PROVIDER_CATALOG[props.provider];
  const kind = props.kind ?? 'text';
  const block = consentBlock(props.provider, kind);
  return (
    <View style={{ gap: th.space.l }}>
      <Title>{ta(kind === 'image' ? 'ai.consent.titleImage' : 'ai.consent.title', { provider: info.label })}</Title>
      <Field label={ta('ai.consent.recipient')}>{block.recipient}</Field>
      <Field label={ta('ai.consent.dataSent')}>{block.dataSent}</Field>
      <Field label={ta('ai.consent.purpose')}>{block.purpose}</Field>
      <Field label={ta('ai.consent.dataUse', { provider: info.label })}>{info.dataUse.summary}</Field>
      {info.dataUse.privacyStep ? <Notice tone={info.dataUse.mayTrainOnFreeTier ? 'warn' : 'info'}>{info.dataUse.privacyStep}</Notice> : null}
      <Caption>{info.ageRule}</Caption>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.space.l }}>
        <LinkButton label={ta('ai.consent.privacy', { provider: info.label })} onPress={() => props.ports.openLink(info.privacyUrl)} />
        <LinkButton label={ta('ai.consent.terms', { provider: info.label })} onPress={() => props.ports.openLink(info.termsUrl)} />
      </View>
      <AppButton label={ta(kind === 'image' ? 'ai.consent.yesImage' : 'ai.consent.yes', { provider: info.label })} onPress={() => props.onAnswer(true)} busy={props.busy} testID="ai-consent-yes" />
      <AppButton kind="secondary" label={ta('ai.consent.no')} onPress={() => props.onAnswer(false)} disabled={props.busy} testID="ai-consent-no" />
      <Caption>{ta('ai.consent.change')}</Caption>
    </View>
  );
}
