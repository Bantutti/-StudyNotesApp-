/**
 * Me -> AI settings: the key is only ever shown masked; Remove, Withdraw and
 * the per-subject "Never send to AI" switch work; the Demo AI switch exists
 * only in development builds.
 */
import { Alert } from 'react-native';

import { maskKey } from '@/modules/ai';

import { AiSettingsScreen, type SubjectsPort } from '../components/AiSettingsScreen';
import { flowWorld, GROQ_KEY } from './helpers';
import { allText, byTestId, fire, one, render, settle, unmount } from './render';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const Glyph = ({ name }: { name: string }) => <Text>{`[${name}]`}</Text>;
  return { __esModule: true, default: Glyph };
});
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

function subjectsPort() {
  const list = [{ id: 's_bio000000000001', name: 'Biology', aiAllowed: true, deleted: false }];
  const port: SubjectsPort = {
    list: async () => list.map((s) => ({ ...s })),
    setAiAllowed: async (id, allowed) => {
      const s = list.find((x) => x.id === id);
      if (s) s.aiAllowed = allowed;
    },
  };
  return { port, list };
}

describe('AI settings', () => {
  it('shows the key masked only, never in full', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true });
    const { port } = subjectsPort();
    const root = await render(<AiSettingsScreen aiui={w.ui} keyVault={w.vault} ports={{ openLink: jest.fn() }} subjects={port} isDev={false} />);
    await settle();
    const text = allText(root);
    expect(text).toContain(maskKey(GROQ_KEY));
    expect(text).not.toContain(GROQ_KEY);
    expect(text).toContain('AI is available to you');
    expect(byTestId(root, 'ai-settings-demo')).toHaveLength(0); // release build: no Demo AI switch
    await unmount(root);
  });

  it('Remove key, Withdraw permission and the subject switch', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true });
    const { port, list } = subjectsPort();
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const root = await render(<AiSettingsScreen aiui={w.ui} keyVault={w.vault} ports={{ openLink: jest.fn() }} subjects={port} isDev={false} />);
    await settle();
    await fire(one(root, 'ai-settings-remove-groq'), 'onPress');
    await settle();
    expect(await w.vault.has('groq')).toBe(false);
    await fire(one(root, 'ai-settings-withdraw-groq'), 'onPress');
    await settle();
    expect(await w.ui.gate.hasConsent('groq', 1)).toBe(false);
    await fire(one(root, 'ai-settings-subject-s_bio000000000001'), 'onValueChange', true);
    await settle();
    expect(list[0]!.aiAllowed).toBe(false);
    spy.mockRestore();
    await unmount(root);
  });

  it('development builds show the Demo AI switch', async () => {
    const w = await flowWorld({ isDev: true });
    const root = await render(<AiSettingsScreen aiui={w.ui} keyVault={w.vault} ports={{ openLink: jest.fn() }} subjects={subjectsPort().port} isDev />);
    await settle();
    await fire(one(root, 'ai-settings-demo'), 'onValueChange', true);
    await settle();
    expect(await w.ui.isDemo()).toBe(true);
    await unmount(root);
  });
});
