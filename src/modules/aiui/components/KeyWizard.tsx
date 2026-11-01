/**
 * Key wizard (Plan Flow 4, screens table "Key wizard": provider list with
 * capability badges, open the key page, paste, test). Asked at the first AI
 * action, never during onboarding (Plan F5).
 *
 * Step 1 lists providers with badges taken from P3a's catalog (free, no card,
 * strict JSON, lecture transcription, trains-on-free-tier warning), the age
 * rule and data use. Step 2 opens the provider's FIXED key page outside the
 * app, then paste + Test (KeyForm).
 */
import { useState } from 'react';
import { View } from 'react-native';

import { AppButton, BodyText, Caption, Surface, Title, useTheme } from '@/core/ui';
import { PROVIDER_CATALOG, PROVIDERS, type Provider } from '@/modules/ai';

import type { ProviderStatus, SaveKeyResult } from '../flow/types';
import type { AiScreenPorts } from '../ports';
import { KeyForm } from './KeyForm';
import { Notice, Tag } from './parts';
import { ta } from '../strings';

/** Badges from the catalog's capability and free-tier facts. */
export function providerBadges(p: Provider): { text: string; tone: 'muted' | 'warn' | 'accent' }[] {
  const info = PROVIDER_CATALOG[p];
  const out: { text: string; tone: 'muted' | 'warn' | 'accent' }[] = [{ text: ta('ai.badge.free'), tone: 'accent' }];
  if (!info.freeTier.needsCard) out.push({ text: ta('ai.badge.noCard'), tone: 'muted' });
  if (info.capabilities.structuredOutput === 'strict') out.push({ text: ta('ai.badge.strict'), tone: 'muted' });
  if (info.capabilities.transcription) out.push({ text: ta('ai.badge.lectures'), tone: 'muted' });
  if (info.dataUse.mayTrainOnFreeTier) out.push({ text: ta('ai.badge.trains'), tone: 'warn' });
  return out;
}

/** One provider's facts, as shown in the wizard (and reused by AI settings). */
export function ProviderFacts({ provider, ports }: { provider: Provider; ports: AiScreenPorts }) {
  const th = useTheme();
  const info = PROVIDER_CATALOG[provider];
  return (
    <View style={{ gap: th.space.s }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.space.xs }}>
        {providerBadges(provider).map((b) => (
          <Tag key={b.text} text={b.text} tone={b.tone} />
        ))}
      </View>
      <Caption>{info.freeTier.note}</Caption>
      <Caption>{info.dataUse.summary}</Caption>
      {info.dataUse.privacyStep ? <Notice tone={info.dataUse.mayTrainOnFreeTier ? 'warn' : 'info'}>{info.dataUse.privacyStep}</Notice> : null}
      <Caption>{info.ageRule}</Caption>
      <Caption>{info.paidNote}</Caption>
      {info.dataUse.privacyStepSource ? (
        <AppButton kind="plain" label={ta('ai.key.learnMore')} onPress={() => ports.openLink(info.dataUse.privacyStepSource?.url ?? info.privacyUrl)} />
      ) : null}
    </View>
  );
}

export function KeyWizard(props: {
  initial: Provider;
  replacing: boolean;
  providers: ProviderStatus[];
  busy: boolean;
  ports: AiScreenPorts;
  onSave: (p: Provider, raw: string, force: boolean) => Promise<SaveKeyResult>;
}) {
  const th = useTheme();
  // Replacing goes straight to the paste step for that provider.
  const [chosen, setChosen] = useState<Provider | null>(props.replacing ? props.initial : null);

  if (!chosen) {
    return (
      <View style={{ gap: th.space.l }}>
        <Title>{ta('ai.key.title')}</Title>
        <BodyText muted>{ta('ai.key.intro')}</BodyText>
        {PROVIDERS.map((p) => {
          const info = PROVIDER_CATALOG[p];
          const has = props.providers.find((x) => x.id === p)?.hasKey ?? false;
          return (
            <Surface key={p}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Title>{info.label}</Title>
                {has ? <Tag text={ta('ai.key.saved')} tone="accent" /> : null}
              </View>
              <ProviderFacts provider={p} ports={props.ports} />
              <AppButton label={ta('ai.key.choose', { provider: info.label })} onPress={() => setChosen(p)} testID={`ai-key-choose-${p}`} />
            </Surface>
          );
        })}
      </View>
    );
  }

  const info = PROVIDER_CATALOG[chosen];
  return (
    <View style={{ gap: th.space.l }}>
      <Title>{props.replacing ? ta('ai.key.replaceTitle', { provider: info.label }) : ta('ai.key.addTitle', { provider: info.label })}</Title>
      <View style={{ gap: th.space.s }}>
        <BodyText>{ta('ai.key.step1', { provider: info.label })}</BodyText>
        <AppButton kind="secondary" icon="open-outline" label={ta('ai.key.openPage', { provider: info.label })} onPress={() => props.ports.openLink(info.keyUrl)} testID="ai-key-open" />
        <BodyText>{ta('ai.key.step2')}</BodyText>
        <BodyText>{ta('ai.key.step3')}</BodyText>
      </View>
      {info.dataUse.privacyStep && info.dataUse.mayTrainOnFreeTier ? <Notice tone="warn">{info.dataUse.privacyStep}</Notice> : null}
      <KeyForm provider={chosen} busy={props.busy} clipboard={props.ports.clipboard} onSave={(raw, force) => props.onSave(chosen, raw, force)} />
      {!props.replacing ? <AppButton kind="plain" label={ta('ai.key.otherProvider')} onPress={() => setChosen(null)} /> : null}
    </View>
  );
}
