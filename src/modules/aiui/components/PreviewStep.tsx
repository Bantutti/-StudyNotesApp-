/**
 * Diff preview (Plan Flow 4, screens table "Diff preview": per-block before
 * and after, accept toggles; Accept all, Discard). Plain text only: the AI's
 * words are shown in <Text>, which never interprets markup (§2.4).
 *
 * Stale changes (the block changed since the AI saw it) start off and can't
 * be turned on. "Report this AI result" saves a local record only.
 */
import { StyleSheet, Text, View } from 'react-native';

import { AppButton, Caption, Surface, Title, useTheme } from '@/core/ui';
import { ACTION_DEFS, PROVIDER_CATALOG } from '@/modules/ai';

import type { DiffRow } from '../diff/viewModel';
import { afterSide, beforeSide, type DiffSegment } from '../diff/wordDiff';
import type { FlowSnapshot } from '../flow/types';
import { Tag, ToggleRow } from './parts';
import { ta } from '../strings';

function Segments({ segments, side }: { segments: DiffSegment[]; side: 'before' | 'after' }) {
  const th = useTheme();
  const shown = side === 'before' ? beforeSide(segments) : afterSide(segments);
  if (shown.length === 0 || shown.every((s) => !s.text.trim())) return <Caption>{ta('ai.preview.nothing')}</Caption>;
  return (
    <Text style={{ color: th.text, fontSize: th.type.body, lineHeight: 22 }}>
      {shown.map((s, i) =>
        s.kind === 'equal' ? (
          <Text key={i}>{s.text}</Text>
        ) : s.kind === 'removed' ? (
          // Removed words: struck through (not colour alone, for colour-blind readers).
          <Text key={i} style={[styles.removed, { color: th.dangerText }]} accessibilityLabel={`${ta('ai.preview.removedWords')} ${s.text}`}>
            {s.text}
          </Text>
        ) : (
          // Added words: underlined and bold.
          <Text key={i} style={[styles.added, { color: th.successText }]} accessibilityLabel={`${ta('ai.preview.addedWords')} ${s.text}`}>
            {s.text}
          </Text>
        ),
      )}
    </Text>
  );
}

function Row({ row, index, accepted, onToggle }: { row: DiffRow; index: number; accepted: boolean; onToggle: () => void }) {
  const th = useTheme();
  return (
    <Surface>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: th.space.s }}>
        <Text style={{ color: th.muted, fontSize: th.type.caption, fontWeight: '700' }}>{`${index + 1}. ${row.label}`}</Text>
        {row.aiAdded ? <Tag text={ta('ai.preview.aiAdded')} tone="accent" /> : null}
        {row.stale ? <Tag text={ta('ai.preview.stale')} tone="warn" /> : null}
      </View>
      {row.kind !== 'insert' ? (
        <View style={{ gap: th.space.xs }}>
          <Caption>{ta('ai.preview.before')}</Caption>
          <Segments segments={row.segments} side="before" />
        </View>
      ) : null}
      {row.kind !== 'delete' ? (
        <View style={{ gap: th.space.xs }}>
          <Caption>{row.kind === 'insert' ? ta('ai.preview.added') : ta('ai.preview.after')}</Caption>
          <Segments segments={row.segments} side="after" />
        </View>
      ) : (
        <Caption>{ta('ai.preview.willRemove')}</Caption>
      )}
      <ToggleRow
        label={ta('ai.preview.accept', { n: index + 1 })}
        value={accepted}
        onChange={onToggle}
        disabled={row.stale}
        detail={row.stale ? ta('ai.preview.staleDetail') : undefined}
        testID={`ai-accept-${row.changeId}`}
      />
    </Surface>
  );
}

export function PreviewStep(props: {
  snap: FlowSnapshot;
  onToggle: (id: string) => void;
  onAcceptAll: (on: boolean) => void;
  onApply: () => void;
  onDiscard: () => void;
  onReport: () => void;
}) {
  const th = useTheme();
  const { snap } = props;
  const p = snap.proposal;
  const label = p ? PROVIDER_CATALOG[p.provider].label : '';
  const acceptable = snap.rows.filter((r) => !r.stale).length;
  const count = snap.accepted.size;
  return (
    <View style={{ gap: th.space.l }}>
      <Title>{p ? ACTION_DEFS[p.action].label : ''}</Title>
      <Caption>
        {ta('ai.preview.summary', { n: snap.rows.length, provider: label, sent: p?.sentBlocks ?? 0 })}
      </Caption>
      {p?.warnings.includes('kept_item_with_subitems') ? <Caption>{ta('ai.preview.keptSubitems')}</Caption> : null}
      {acceptable > 1 ? (
        <ToggleRow label={ta('ai.preview.acceptAll')} value={count === acceptable} onChange={props.onAcceptAll} testID="ai-accept-all" />
      ) : null}
      {snap.rows.map((r, i) => (
        <Row key={r.changeId} row={r} index={i} accepted={snap.accepted.has(r.changeId)} onToggle={() => props.onToggle(r.changeId)} />
      ))}
      <AppButton
        label={count === 0 ? ta('ai.preview.applyNone') : ta('ai.preview.apply', { n: count })}
        onPress={props.onApply}
        busy={snap.busy}
        disabled={count === 0}
        testID="ai-apply"
      />
      <AppButton kind="secondary" label={ta('ai.preview.discard')} onPress={props.onDiscard} disabled={snap.busy} testID="ai-discard" />
      <Caption>{ta('ai.preview.undoHint')}</Caption>
      {snap.reported ? (
        <Caption>{ta('ai.report.saved')}</Caption>
      ) : (
        <AppButton kind="plain" icon="flag-outline" label={ta('ai.report.button')} onPress={props.onReport} testID="ai-report" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  removed: { textDecorationLine: 'line-through' },
  added: { textDecorationLine: 'underline', fontWeight: '700' },
});
