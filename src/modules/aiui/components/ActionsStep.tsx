/**
 * AI action sheet (Plan screens table: "actions, scope (selection, note),
 * provider chip"). Flashcards and Quiz me are hidden until P4c (Q5 = B).
 * Explain needs a selection, so it is disabled with a reason without one.
 */
import { View } from 'react-native';

import { Caption, SectionHeader, useTheme } from '@/core/ui';
import { ACTION_DEFS, PROVIDER_CATALOG, type AiActionId, type Provider } from '@/modules/ai';

import { actionMeta } from '../actionsMeta';
import { visibleActions } from '../flow/controller';
import type { FlowSnapshot, Notice as NoticeCode, ScopeChoice } from '../flow/types';
import { usageText } from '../format';
import { Chip, Notice, OptionRow } from './parts';
import { ta } from '../strings';

const NOTICE_KEYS = { cancelled: 'ai.notice.cancelled', not_sent: 'ai.notice.notSent', discarded: 'ai.notice.discarded' } as const;

export function ActionsStep(props: {
  snap: FlowSnapshot;
  notice: NoticeCode;
  onAction: (id: AiActionId) => void;
  onScope: (s: ScopeChoice) => void;
  onProvider: (p: Provider) => void;
  onKey: (p: Provider) => void;
}) {
  const th = useTheme();
  const { snap } = props;
  const selectionOn = snap.hasSelection && snap.scope === 'selection';
  const current = snap.providers.find((p) => p.id === snap.provider);
  return (
    <View style={{ gap: th.space.l }}>
      {props.notice ? <Notice>{ta(NOTICE_KEYS[props.notice])}</Notice> : null}

      <SectionHeader>{ta('ai.sheet.scope')}</SectionHeader>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: th.space.s }}>
        <Chip label={ta('ai.sheet.selection')} selected={selectionOn} disabled={!snap.hasSelection} onPress={() => props.onScope('selection')} testID="ai-scope-selection" />
        <Chip label={ta('ai.sheet.note')} selected={!selectionOn} onPress={() => props.onScope('note')} testID="ai-scope-note" />
      </View>
      {!snap.hasSelection ? <Caption>{ta('ai.sheet.selectHint')}</Caption> : null}

      <SectionHeader>{ta('ai.sheet.provider')}</SectionHeader>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.space.s }}>
        {snap.providers.map((p) => (
          <Chip
            key={p.id}
            label={p.hasKey ? p.label : ta('ai.sheet.noKey', { provider: p.label })}
            selected={p.id === snap.provider}
            onPress={() => props.onProvider(p.id)}
            testID={`ai-provider-${p.id}`}
          />
        ))}
      </View>
      {snap.usage ? <Caption>{usageText(snap.usage)}</Caption> : null}
      {current && !current.hasKey ? <Caption>{ta('ai.sheet.keyLater', { provider: PROVIDER_CATALOG[current.id].label })}</Caption> : null}
      {current?.hasKey ? (
        <Caption>
          {ta('ai.sheet.limitsChecked', { date: PROVIDER_CATALOG[current.id].freeTier.checkedOn })}
        </Caption>
      ) : null}

      <SectionHeader>{ta('ai.sheet.actions')}</SectionHeader>
      <View style={{ gap: th.space.s }}>
        {visibleActions().map((id) => {
          const m = actionMeta(id);
          const needsSel = ACTION_DEFS[id].needsSelection && !selectionOn;
          return (
            <OptionRow
              key={id}
              icon={m.icon}
              title={m.label}
              subtitle={needsSel ? ta('ai.sheet.needsSelection') : m.description}
              disabled={needsSel || snap.busy}
              onPress={() => props.onAction(id)}
              testID={`ai-action-${id}`}
            />
          );
        })}
      </View>
      {current?.hasKey ? (
        <OptionRow icon="key-outline" title={ta('ai.sheet.replaceKey', { provider: current.label })} onPress={() => props.onKey(current.id)} testID="ai-replace-key" />
      ) : null}
    </View>
  );
}
