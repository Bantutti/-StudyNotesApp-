import { useEffect, useState } from 'react';
import { Linking, TextInput } from 'react-native';

import { useServices } from '@/composition';
import { userMessage } from '@/core';
import { Banner, Body, Button, Card, Row, Screen, ui } from '@/core/ui';
import { maskKey, PROVIDER_INFO } from '@/modules/ai';

export default function Settings() {
  const { keyVault, transcriber } = useServices();
  const [input, setInput] = useState('');
  const [stored, setStored] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const k = await keyVault.get('groq');
    setStored(k ? maskKey(k) : null);
  };
  useEffect(() => {
    let alive = true;
    keyVault.get('groq').then((k) => {
      if (alive) setStored(k ? maskKey(k) : null);
    });
    return () => {
      alive = false;
    };
  }, [keyVault]);

  const save = async () => {
    try {
      await keyVault.set('groq', input);
      setInput('');
      setMsg('Key saved in this phone’s secure storage.');
      await reload();
    } catch (e) {
      setMsg(userMessage(e));
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      setMsg((await transcriber.testKey()) ? 'Key works.' : 'Groq rejected this key.');
    } catch (e) {
      setMsg(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await keyVault.remove('groq');
    setMsg('Key deleted from this phone.');
    await reload();
  };

  return (
    <Screen>
      <Banner tone="info">
        Your key stays on this phone in secure storage (Keychain / Keystore). It is sent only to Groq when you
        transcribe, never to us, and never written to logs. Do not share it or paste it into chats.
      </Banner>
      <Card title="Groq API key (free)">
        <Body>Status: {stored ? `saved (${stored})` : 'no key saved'}</Body>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="gsk_…"
          secureTextEntry
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          importantForAutofill="no"
          textContentType="none"
          spellCheck={false}
          accessibilityLabel="Groq API key"
          style={{ minHeight: 48, borderWidth: 1, borderColor: ui.line, borderRadius: 10, paddingHorizontal: 12, backgroundColor: ui.paper, color: ui.ink }}
        />
        <Row>
          <Button label="Save key" disabled={!input.trim()} onPress={save} />
          <Button kind="secondary" label="Test key" busy={busy} disabled={!stored} onPress={test} />
          <Button kind="danger" label="Delete" disabled={!stored} onPress={remove} />
        </Row>
        {msg ? <Body muted>{msg}</Body> : null}
        <Button kind="secondary" label="Get a free key at console.groq.com" onPress={() => Linking.openURL(PROVIDER_INFO.groq.keyUrl)} />
      </Card>
    </Screen>
  );
}
