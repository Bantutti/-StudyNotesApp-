/**
 * Paste, Test and save a key (Plan Flow 4 key wizard step 3; also used to
 * Replace a key in AI settings).
 *
 * - The field is a secure (hidden) text field; the key is never shown in
 *   full again after saving (AI settings shows maskKey only).
 * - Test runs against the provider with the CANDIDATE key; it is stored in
 *   the Keychain / Keystore only if the provider accepts it.
 * - After a successful save, if the clipboard still holds this key, it is
 *   cleared (the student is told so under the field).
 * - The typed key lives only in this component's state: cleared on save,
 *   and gone when the form closes (§3.3).
 */
import { useState } from 'react';
import { View } from 'react-native';

import { AppButton, Caption, TextField, useTheme } from '@/core/ui';
import { PROVIDER_CATALOG, type Provider } from '@/modules/ai';

import type { SaveKeyResult } from '../flow/types';
import type { ClipboardPort } from '../ports';
import { Notice } from './parts';
import { ta } from '../strings';

export function KeyForm(props: {
  provider: Provider;
  onSave: (raw: string, force: boolean) => Promise<SaveKeyResult>;
  clipboard?: ClipboardPort;
  busy?: boolean;
  onSaved?: () => void;
}) {
  const th = useTheme();
  const label = PROVIDER_CATALOG[props.provider].label;
  const [value, setValue] = useState('');
  const [result, setResult] = useState<SaveKeyResult | null>(null);
  const [working, setWorking] = useState(false);

  const save = async (force: boolean) => {
    if (!value.trim() || working) return;
    setWorking(true);
    const raw = value;
    try {
      const r = await props.onSave(raw, force);
      setResult(r);
      if (r.kind === 'saved') {
        setValue('');
        try {
          if (props.clipboard && (await props.clipboard.getString()).trim() === raw.trim()) await props.clipboard.setString('');
        } catch {
          // Clipboard access can be refused; the key is saved either way.
        }
        props.onSaved?.();
      }
    } finally {
      setWorking(false);
    }
  };

  const paste = async () => {
    if (!props.clipboard) return;
    try {
      const s = await props.clipboard.getString();
      setValue(s.trim().slice(0, 200));
      setResult(null);
    } catch {
      // Nothing to paste.
    }
  };

  const busy = working || !!props.busy;
  return (
    <View style={{ gap: th.space.m }}>
      <TextField
        label={ta('ai.key.pasteLabel', { provider: label })}
        value={value}
        onChangeText={(v) => {
          setValue(v);
          setResult(null);
        }}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
        spellCheck={false}
        maxLength={200}
        error={result?.kind === 'bad_format' ? result.message : result?.kind === 'rejected' ? ta('ai.key.rejected', { provider: label }) : null}
        testID="ai-key-input"
      />
      {props.clipboard ? <AppButton kind="secondary" icon="clipboard-outline" label={ta('ai.key.paste')} onPress={() => void paste()} disabled={busy} testID="ai-key-paste" /> : null}
      <AppButton label={ta('ai.key.testSave')} onPress={() => void save(false)} busy={busy} disabled={!value.trim()} testID="ai-key-save" />
      {result?.kind === 'unchecked' ? (
        <View style={{ gap: th.space.s }}>
          <Notice tone="warn">{`${result.message} ${ta('ai.key.uncheckedHint')}`}</Notice>
          <AppButton kind="secondary" label={ta('ai.key.saveAnyway')} onPress={() => void save(true)} disabled={busy} testID="ai-key-save-anyway" />
        </View>
      ) : null}
      <Caption>{ta('ai.key.safety')}</Caption>
    </View>
  );
}
