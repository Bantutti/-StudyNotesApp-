/** App lock settings (plan F8, Q9). Stored on this phone only (kv "applock"). */
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';

import { bumpLockRevision, useStore } from '@/composition';
import { AppScreen, BodyText, Caption, ListRow, SectionHeader } from '@/core/ui';
import { DEFAULT_LOCK, expoDeviceAuth, LOCK_KEY, LOCK_NS, LOCK_TIMEOUTS_MS, lockKvSchema, type LockSettings } from '@/modules/applock';

const LABEL: Record<number, string> = { 0: 'Immediately', 60_000: 'After 1 minute', 300_000: 'After 5 minutes', 900_000: 'After 15 minutes' };

export default function AppLockSettings() {
  const store = useStore();
  const [s, setS] = useState<LockSettings>(DEFAULT_LOCK);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void store.kv.get(LOCK_NS, LOCK_KEY, lockKvSchema).then((v) => v && setS(v));
  }, [store]);

  const save = async (next: LockSettings) => {
    setMsg(null);
    if (next.enabled && !s.enabled) {
      if (!(await expoDeviceAuth.canLock())) return setMsg('Set up a screen lock (PIN, pattern, fingerprint or face) in your phone settings first.');
      if (!(await expoDeviceAuth.authenticate('Turn on app lock'))) return;
    }
    await store.kv.set(LOCK_NS, LOCK_KEY, next);
    setS(next);
    bumpLockRevision();
  };

  return (
    <AppScreen>
      <Stack.Screen options={{ title: 'App lock' }} />
      <ListRow
        icon={s.enabled ? 'lock-closed' : 'lock-open-outline'}
        title={s.enabled ? 'App lock is on' : 'App lock is off'}
        subtitle={s.enabled ? 'Tap to turn off' : 'Use your fingerprint, face or phone PIN to open NotedPo'}
        onPress={() => void save({ ...s, enabled: !s.enabled })}
        testID="applock-toggle"
      />
      {msg ? <BodyText>{msg}</BodyText> : null}
      <SectionHeader>Lock again</SectionHeader>
      {LOCK_TIMEOUTS_MS.map((t) => (
        <ListRow key={t} title={LABEL[t] ?? ''} icon={s.timeoutMs === t ? 'radio-button-on' : 'radio-button-off'} onPress={() => void save({ ...s, timeoutMs: t })} />
      ))}
      <Caption>
        While app lock is on, notes are hidden in the app switcher, and on Android screenshots of the app are blocked. App lock hides the app; it doesn’t encrypt your notes. On iPhone in Expo Go, Face ID isn’t available, so your passcode is used.
      </Caption>
    </AppScreen>
  );
}
