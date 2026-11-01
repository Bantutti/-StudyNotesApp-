/**
 * The sync chip (plan F1): Saved on device, Syncing, Synced, Offline, Needs
 * attention. Shown in the note top bar; tapping it opens Me > Sync.
 */
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { useSyncView, type SyncView } from '@/composition';
import { useTheme } from '@/core/ui';

export function chipLabel(v: SyncView): string {
  if (v.kind !== 'on') return 'Saved on device';
  const s = v.status;
  if (s.conflicts > 0 || s.quarantined > 0 || s.phase === 'error') return 'Needs attention';
  if (s.phase === 'offline') return 'Offline';
  if (s.phase === 'syncing') return 'Syncing';
  return s.pending > 0 ? 'Syncing' : 'Synced';
}

export function SyncChip() {
  const th = useTheme();
  const label = chipLabel(useSyncView());
  const attention = label === 'Needs attention';
  return (
    <Pressable
      testID="sync-chip"
      accessibilityRole="button"
      accessibilityLabel={`Sync: ${label}`}
      onPress={() => router.push(attention ? '/sync/attention' : '/(tabs)/me')}
      style={{ paddingHorizontal: th.space.s, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: attention ? th.danger : th.line }}
    >
      <Text style={{ color: attention ? th.dangerText : th.muted, fontSize: th.type.caption, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/** Home banner when conflicts or invalid docs wait in Needs attention. */
export function NeedsAttentionBanner() {
  const th = useTheme();
  const v = useSyncView();
  if (v.kind === 'accountGone') {
    return (
      <Pressable testID="sync-account-gone" onPress={() => router.push('/(tabs)/me')} style={{ padding: th.space.m, borderRadius: th.radius.card, backgroundColor: th.surface, borderWidth: 1, borderColor: th.danger }}>
        <Text style={{ color: th.text, fontSize: th.type.body }}>Your account was deleted on another device. Your notes are still on this phone.</Text>
      </Pressable>
    );
  }
  if (v.kind !== 'on' || v.status.conflicts + v.status.quarantined === 0) return null;
  const n = v.status.conflicts;
  return (
    <Pressable testID="sync-attention-banner" accessibilityRole="button" onPress={() => router.push('/sync/attention')} style={{ padding: th.space.m, borderRadius: th.radius.card, backgroundColor: th.surface, borderWidth: 1, borderColor: th.danger }}>
      <Text style={{ color: th.text, fontSize: th.type.body, fontWeight: '600' }}>
        {n > 0 ? `${n === 1 ? 'A note' : `${n} notes`} changed on two devices. Choose what to keep.` : 'Some synced items need attention.'}
      </Text>
    </Pressable>
  );
}
