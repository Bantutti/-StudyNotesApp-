/**
 * Renders nothing of the app while locked (no notes behind a translucent
 * overlay), and an opaque cover while the app is inactive, so the iOS app
 * switcher snapshot never shows a note. Settings live in the store's kv
 * (namespace "applock"), never synced.
 */
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import * as z from 'zod';

import { AppButton, AppScreen, BodyText, Title, useTheme } from '@/core/ui';

import { DEFAULT_LOCK, initialLock, lockReducer, lockSettingsSchema, type LockSettings } from './lockMachine';
import type { DeviceAuthPort, ScreenPrivacyPort } from './ports';

export interface LockStorage {
  get(): Promise<LockSettings | null>;
}

export const LOCK_NS = 'applock';
export const LOCK_KEY = 'settings';
export const lockKvSchema: z.ZodType<LockSettings> = lockSettingsSchema;

const styles = StyleSheet.create({ fill: { flex: 1 } });

export function LockGate(props: {
  storage: LockStorage;
  device: DeviceAuthPort;
  privacy: ScreenPrivacyPort;
  /** Bumped by the settings screen after a change. */
  revision: number;
  appName: string;
  children: ReactNode;
}) {
  const th = useTheme();
  const [state, dispatch] = useReducer(lockReducer, initialLock({ ...DEFAULT_LOCK, enabled: true }));
  const [ready, setReady] = useState(false);
  const [inactive, setInactive] = useState(false);
  const prompting = useRef(false);

  useEffect(() => {
    let alive = true;
    props.storage.get().then((s) => {
      if (!alive) return;
      const settings = s ?? DEFAULT_LOCK;
      dispatch(ready ? { type: 'settings', settings } : { type: 'start', settings });
      void props.privacy.protect(settings.enabled);
      setReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the settings revision changes
  }, [props.revision]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setInactive(s !== 'active');
      if (s === 'background') dispatch({ type: 'background', at: Date.now() });
      if (s === 'active') dispatch({ type: 'foreground', at: Date.now() });
    });
    return () => sub.remove();
  }, []);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      if (await props.device.authenticate(`Unlock ${props.appName}`)) dispatch({ type: 'unlocked' });
    } finally {
      prompting.current = false;
    }
  }, [props.device, props.appName]);

  useEffect(() => {
    if (ready && state.locked && !inactive) void unlock();
  }, [ready, state.locked, inactive, unlock]);

  if (!ready) return <View style={[StyleSheet.absoluteFill, { backgroundColor: th.bg }]} />;
  const lockScreen = (
    <AppScreen edges={['top', 'left', 'right', 'bottom']}>
      <Title>{props.appName} is locked</Title>
      <BodyText muted>Use your fingerprint, face or phone PIN to open your notes.</BodyText>
      <AppButton label="Unlock" onPress={() => void unlock()} testID="applock-unlock" />
    </AppScreen>
  );
  // Cold start: nothing of the app is mounted until the first unlock (deep links wait).
  if (state.locked && !state.everUnlocked) return lockScreen;
  const hidden = state.locked || (inactive && state.settings.enabled);
  return (
    <>
      {/* Kept mounted (navigation state survives a re-lock) but hidden from screen readers and covered. */}
      <View style={styles.fill} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={hidden}>
        {props.children}
      </View>
      {state.locked ? <View style={[StyleSheet.absoluteFill, { backgroundColor: th.bg }]}>{lockScreen}</View> : null}
      {!state.locked && inactive && state.settings.enabled ? <View testID="applock-cover" style={[StyleSheet.absoluteFill, { backgroundColor: th.bg }]} /> : null}
    </>
  );
}
