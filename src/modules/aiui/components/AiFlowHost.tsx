/**
 * The AI modal: renders the flow controller's current step (ALGORITHMS §3).
 *
 * Mounted ONCE near the root (composition AiWiring). It is a React Native
 * Modal rather than a pushed route, so the note screen underneath keeps its
 * focus and editing session (no "left the note" save, no reload), and no
 * note data or keys ever go into navigation params (§3.3).
 *
 * Closing from any step (X button, Android back, iOS swipe-down) settles the
 * flow as cancelled: nothing is changed.
 */
import { useSyncExternalStore } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core';
import { IconButton, useTheme } from '@/core/ui';

import type { AiFlow } from '../flow/controller';
import type { FlowSnapshot } from '../flow/types';
import type { AiScreenPorts } from '../ports';
import { ActionsStep } from './ActionsStep';
import { AgeForm } from './AgeForm';
import { ConsentStep } from './ConsentStep';
import { KeyWizard } from './KeyWizard';
import { BlockedPanel, EmptyPanel, ErrorPanel, MinorPanel, RunningPanel } from './Panels';
import { PreviewStep } from './PreviewStep';
import { ReportStep } from './ReportStep';
import { Tag } from './parts';
import { ta } from '../strings';

/** Steps where "Back" returns to the action sheet instead of closing. */
const HAS_BACK = new Set(['age', 'key', 'consent']);

function Body({ flow, snap, ports }: { flow: AiFlow; snap: FlowSnapshot; ports: AiScreenPorts }) {
  const s = snap.step;
  switch (s.name) {
    case 'closed':
      return null;
    case 'blocked':
      return <BlockedPanel onClose={() => flow.close()} />;
    case 'minor':
      return <MinorPanel recheckAvailable={s.recheckAvailable} onClose={() => flow.close()} onRecheck={() => void flow.recheckAge()} />;
    case 'actions':
      return (
        <ActionsStep
          snap={snap}
          notice={s.notice}
          onAction={(id) => void flow.chooseAction(id)}
          onScope={(sc) => flow.setScope(sc)}
          onProvider={(p) => void flow.setProvider(p)}
          onKey={(p) => flow.openKey(p, true)}
        />
      );
    case 'age':
      return <AgeForm busy={snap.busy} onResult={(adult) => void flow.answerAge(adult)} />;
    case 'key':
      return (
        <KeyWizard
          key={`${s.provider}-${s.replacing}`}
          initial={s.provider}
          replacing={s.replacing}
          providers={snap.providers}
          busy={snap.busy}
          ports={ports}
          onSave={(p, raw, force) => flow.saveKey(p, raw, force)}
        />
      );
    case 'consent':
      return <ConsentStep provider={s.provider} busy={snap.busy} ports={ports} onAnswer={(yes) => void flow.answerConsent(yes)} />;
    case 'running':
      return <RunningPanel progress={s.progress} provider={snap.provider} onCancel={() => flow.cancelRun()} />;
    case 'preview':
      return (
        <PreviewStep
          snap={snap}
          onToggle={(id) => flow.toggle(id)}
          onAcceptAll={(on) => flow.acceptAll(on)}
          onApply={() => void flow.apply()}
          onDiscard={() => flow.discard()}
          onReport={() => flow.openReport()}
        />
      );
    case 'empty':
      return <EmptyPanel provider={snap.provider} reported={snap.reported} onClose={() => flow.close()} onReport={() => flow.openReport()} />;
    case 'error':
      return <ErrorPanel error={s.error} onNext={() => void flow.nextStep()} onClose={() => flow.close()} />;
    case 'report':
      return <ReportStep busy={snap.busy} onSubmit={(r, c) => void flow.submitReport(r, c)} onCancel={() => flow.closeReport()} />;
  }
}

export function AiFlowHost({ flow, ports }: { flow: AiFlow; ports: AiScreenPorts }) {
  const th = useTheme();
  const snap = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  const visible = snap.step.name !== 'closed';
  const back = HAS_BACK.has(snap.step.name);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => flow.close()}>
      <SafeAreaView style={[styles.fill, { backgroundColor: th.bg }]} edges={['top', 'bottom', 'left', 'right']}>
        <View style={[styles.header, { borderColor: th.line }]}>
          {back ? <IconButton icon="chevron-back" label={t('common.back')} onPress={() => flow.back()} testID="ai-back" /> : <View style={styles.side} />}
          <View style={styles.title}>
            <Text accessibilityRole="header" style={{ color: th.text, fontSize: th.type.title, fontWeight: '700' }}>
              {ta('ai.title')}
            </Text>
            {snap.demo ? <Tag text={ta('ai.demo.tag')} tone="warn" /> : null}
          </View>
          <IconButton icon="close" label={ta('ai.close')} onPress={() => flow.close()} testID="ai-close" />
        </View>
        {snap.demo ? (
          <Text style={[styles.demo, { color: th.warnText, fontSize: th.type.caption }]}>{ta('ai.demo.banner')}</Text>
        ) : null}
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: th.space.l, gap: th.space.l }} keyboardShouldPersistTaps="handled">
            <Body flow={flow} snap={snap} ports={ports} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  side: { width: 44 },
  title: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  demo: { paddingHorizontal: 16, paddingVertical: 6, textAlign: 'center' },
});
