/**
 * Component tests for the AI screens (test-renderer, fake adapters).
 *
 * - Age form: empty start, neutral wording (no "18" before the answer),
 *   boundary month and day, only the RESULT goes up.
 * - Key form: hidden field, Test then save, rejected key message, the
 *   clipboard is cleared after saving a pasted key.
 * - Action sheet: Explain disabled without a selection, cards/quiz hidden.
 * - Consent: every catalog field shown, Mistral's training steps included.
 * - Preview: toggles, stale changes locked off, plain text only.
 * - The modal (AiFlowHost) from open to apply, and close = cancel.
 */
import { PROVIDER_CATALOG, type Proposal } from '@/modules/ai';

import { AgeForm } from '../components/AgeForm';
import { ActionsStep } from '../components/ActionsStep';
import { AiFlowHost } from '../components/AiFlowHost';
import { ConsentStep } from '../components/ConsentStep';
import { KeyForm } from '../components/KeyForm';
import { PreviewStep } from '../components/PreviewStep';
import { buildDiffRows, initialAccepted } from '../diff/viewModel';
import type { FlowSnapshot } from '../flow/types';
import { AI_EN } from '../strings';
import { bid, flowWorld, GROQ_KEY, noteDoc, para } from './helpers';
import { allText, byTestId, fire, isDisabled, one, render, settle, unmount } from './render';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const Glyph = ({ name }: { name: string }) => <Text>{`[${name}]`}</Text>;
  return { __esModule: true, default: Glyph };
});
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const NOV1 = new Date(2026, 10, 1, 10, 0).getTime();
const ports = { openLink: jest.fn() };

describe('AgeForm (§1, Q2 = A, Q3 = A)', () => {
  it('starts empty and never mentions the cut-off before the answer', async () => {
    const root = await render(<AgeForm onResult={() => undefined} now={() => NOV1} />);
    expect(one(root, 'ai-age-year').props.value).toBe('');
    const shown = allText(root);
    expect(shown).not.toMatch(/18|adult|older|under/i);
    // The strings themselves stay neutral too.
    for (const k of Object.keys(AI_EN).filter((x) => x.startsWith('ai.age.'))) expect(AI_EN[k as keyof typeof AI_EN]).not.toMatch(/18|adult|older/i);
    await unmount(root);
  });

  it('a clear year reports only the result', async () => {
    const results: boolean[] = [];
    const root = await render(<AgeForm onResult={(a) => results.push(a)} now={() => NOV1} />);
    await fire(one(root, 'ai-age-year'), 'onChangeText', '2001');
    await fire(one(root, 'ai-age-next'), 'onPress');
    expect(results).toEqual([true]);
    expect(one(root, 'ai-age-year').props.value).toBe(''); // cleared after the answer
    await fire(one(root, 'ai-age-year'), 'onChangeText', '2012');
    await fire(one(root, 'ai-age-next'), 'onPress');
    expect(results).toEqual([true, false]);
    await unmount(root);
  });

  it('boundary year asks the month, and the day only for this month', async () => {
    const results: boolean[] = [];
    const root = await render(<AgeForm onResult={(a) => results.push(a)} now={() => NOV1} />);
    await fire(one(root, 'ai-age-year'), 'onChangeText', '2008');
    await fire(one(root, 'ai-age-next'), 'onPress');
    expect(byTestId(root, 'ai-age-month-11')).toHaveLength(1);
    expect(byTestId(root, 'ai-age-month-11')[0]!.props.accessibilityState).toMatchObject({ selected: false }); // no default
    await fire(one(root, 'ai-age-month-11'), 'onPress');
    await fire(one(root, 'ai-age-next'), 'onPress');
    expect(byTestId(root, 'ai-age-day')).toHaveLength(1);
    await fire(one(root, 'ai-age-day'), 'onChangeText', '2');
    await fire(one(root, 'ai-age-next'), 'onPress');
    expect(results).toEqual([false]); // turns 18 tomorrow
    await unmount(root);
  });

  it('strips non-digits and rejects a future year', async () => {
    const results: boolean[] = [];
    const root = await render(<AgeForm onResult={(a) => results.push(a)} now={() => NOV1} />);
    await fire(one(root, 'ai-age-year'), 'onChangeText', '20x9');
    expect(one(root, 'ai-age-year').props.value).toBe('209');
    await fire(one(root, 'ai-age-year'), 'onChangeText', '2030');
    await fire(one(root, 'ai-age-next'), 'onPress');
    expect(results).toEqual([]);
    expect(allText(root)).toContain(AI_EN['ai.age.badYear']);
    await unmount(root);
  });
});

describe('KeyForm', () => {
  it('is a hidden field; tests, saves and clears a pasted key from the clipboard', async () => {
    let clip = GROQ_KEY;
    const clipboard = { getString: async () => clip, setString: async (s: string) => void (clip = s) };
    const saves: string[] = [];
    const root = await render(<KeyForm provider="groq" clipboard={clipboard} onSave={async (raw) => (saves.push(raw), { kind: 'saved' })} />);
    const input = one(root, 'ai-key-input');
    expect(input.props.secureTextEntry).toBe(true);
    expect(input.props.autoCorrect).toBe(false);
    await fire(one(root, 'ai-key-paste'), 'onPress');
    expect(one(root, 'ai-key-input').props.value).toBe(GROQ_KEY);
    await fire(one(root, 'ai-key-save'), 'onPress');
    await settle();
    expect(saves).toEqual([GROQ_KEY]);
    expect(clip).toBe(''); // cleared
    expect(one(root, 'ai-key-input').props.value).toBe('');
    expect(allText(root)).not.toContain(GROQ_KEY); // never shown as text
    await unmount(root);
  });

  it('shows the provider-named rejection and offers Save anyway only when unchecked', async () => {
    let next: 'rejected' | 'unchecked' = 'rejected';
    const root = await render(
      <KeyForm provider="groq" onSave={async () => (next === 'rejected' ? { kind: 'rejected' } : { kind: 'unchecked', message: 'Needs internet.' })} />,
    );
    await fire(one(root, 'ai-key-input'), 'onChangeText', GROQ_KEY);
    await fire(one(root, 'ai-key-save'), 'onPress');
    await settle();
    expect(allText(root)).toContain('This key was rejected by Groq.');
    expect(byTestId(root, 'ai-key-save-anyway')).toHaveLength(0);
    next = 'unchecked';
    await fire(one(root, 'ai-key-save'), 'onPress');
    await settle();
    expect(byTestId(root, 'ai-key-save-anyway')).toHaveLength(1);
    await unmount(root);
  });
});

function snapshot(over: Partial<FlowSnapshot> = {}): FlowSnapshot {
  return {
    step: { name: 'actions', notice: null },
    action: null,
    provider: 'groq',
    providers: [
      { id: 'groq', label: 'Groq', hasKey: true },
      { id: 'mistral', label: 'Mistral', hasKey: false },
    ],
    scope: 'note',
    hasSelection: false,
    usage: { provider: 'groq', requests: 12, dailyLimit: 1000, remaining: null, checkedOn: '2026-11-01' },
    rows: [],
    accepted: new Set(),
    proposal: null,
    demo: false,
    busy: false,
    reported: false,
    ...over,
  };
}

describe('ActionsStep', () => {
  const noop = () => undefined;
  it('disables Explain without a selection and hides cards and quiz', async () => {
    const root = await render(<ActionsStep snap={snapshot()} notice={null} onAction={noop} onScope={noop} onProvider={noop} onKey={noop} />);
    expect(isDisabled(one(root, 'ai-action-explain'))).toBe(true);
    expect(isDisabled(one(root, 'ai-action-beautify'))).toBe(false);
    expect(byTestId(root, 'ai-action-flashcards')).toHaveLength(0);
    expect(byTestId(root, 'ai-action-quiz')).toHaveLength(0);
    expect(isDisabled(one(root, 'ai-scope-selection'))).toBe(true);
    expect(allText(root)).toContain('Groq · 12 of 1,000 requests today.');
    expect(allText(root)).toContain('Mistral (no key yet)');
    await unmount(root);
  });

  it('enables Explain with a selection', async () => {
    const root = await render(<ActionsStep snap={snapshot({ hasSelection: true, scope: 'selection' })} notice="cancelled" onAction={noop} onScope={noop} onProvider={noop} onKey={noop} />);
    expect(isDisabled(one(root, 'ai-action-explain'))).toBe(false);
    expect(allText(root)).toContain('Cancelled. Nothing was changed.');
    await unmount(root);
  });
});

describe('ConsentStep (Apple 5.1.2(i))', () => {
  it.each([['groq' as const], ['mistral' as const]])('%s: shows every consent field and the data use', async (p) => {
    const answers: boolean[] = [];
    const root = await render(<ConsentStep provider={p} busy={false} ports={ports} onAnswer={(y) => answers.push(y)} />);
    const text = allText(root);
    const info = PROVIDER_CATALOG[p];
    for (const s of [info.consent.recipient, info.consent.dataSent, info.consent.purpose, info.dataUse.summary, info.ageRule]) expect(text).toContain(s);
    if (info.dataUse.privacyStep) expect(text).toContain(info.dataUse.privacyStep);
    expect(text).toContain(`Yes, send to ${info.label}`);
    await fire(one(root, 'ai-consent-no'), 'onPress');
    await fire(one(root, 'ai-consent-yes'), 'onPress');
    expect(answers).toEqual([false, true]);
    await unmount(root);
  });

  it('Mistral shows the training opt-out path', async () => {
    const root = await render(<ConsentStep provider="mistral" busy={false} ports={ports} onAnswer={() => undefined} />);
    expect(allText(root)).toContain('Anonymous improvement data');
    await unmount(root);
  });
});

describe('PreviewStep', () => {
  const proposal = (): Proposal => ({
    id: 'aip_1',
    action: 'clarify',
    provider: 'groq',
    models: ['openai/gpt-oss-120b'],
    promptVersion: 'clarify@1.base@1',
    createdAt: 0,
    baseDocJson: '',
    sentBlockIds: [bid(2), bid(3)],
    changes: [
      { changeId: 'c1', kind: 'replace', targetId: bid(2), afterId: null, before: para(bid(2), 'the mitochondria makes energy'), after: [para(bid(2), 'Mitochondria make <b>energy</b>.')], aiAdded: false, removesIds: [] },
      // Stale: its "before" no longer matches the note.
      { changeId: 'c2', kind: 'replace', targetId: bid(3), afterId: null, before: para(bid(3), 'something else'), after: [para(bid(3), 'Osmosis.')], aiAdded: false, removesIds: [] },
    ],
    cards: [],
    quiz: [],
    warnings: [],
    snapshotReason: 'Before Improve clarity',
    usage: { requests: 1, inputTokens: 1, outputTokens: 1, estimated: false },
  });

  it('shows words added and removed as plain text, with stale changes locked off', async () => {
    const rows = buildDiffRows(noteDoc(), proposal());
    const accepted = initialAccepted(rows);
    expect([...accepted]).toEqual(['c1']);
    const toggled: string[] = [];
    const snap = snapshot({ step: { name: 'preview' }, rows, accepted, proposal: { action: 'clarify', provider: 'groq', models: [], promptVersion: '', sentBlocks: 2, warnings: [] } });
    const root = await render(<PreviewStep snap={snap} onToggle={(id) => toggled.push(id)} onAcceptAll={() => undefined} onApply={() => undefined} onDiscard={() => undefined} onReport={() => undefined} />);
    const text = allText(root);
    expect(text).toContain('Mitochondria make <b>energy</b>.'.split(' ')[0]);
    expect(text).toContain('<b>energy</b>.'); // shown as literal text, never as markup
    expect(text).toContain(AI_EN['ai.preview.stale']);
    expect(one(root, 'ai-accept-c2').props.disabled).toBe(true);
    expect(one(root, 'ai-accept-c1').props.value).toBe(true);
    expect(allText(root)).toContain('Apply 1');
    await fire(one(root, 'ai-accept-c1'), 'onValueChange', false);
    expect(toggled).toEqual(['c1']);
    await unmount(root);
  });
});

describe('AiFlowHost (the modal)', () => {
  it('open -> Beautify -> preview -> Apply, then closed', async () => {
    const w = await flowWorld({ adult: true, consent: true, groqKey: true });
    const root = await render(<AiFlowHost flow={w.ui.flow} ports={ports} />);
    expect(byTestId(root, 'ai-close')).toHaveLength(0); // hidden while closed
    let result: unknown;
    const p = w.ui.flow.start(w.ctx(), true).then((r) => (result = r));
    await settle();
    await fire(one(root, 'ai-action-beautify'), 'onPress');
    await settle();
    expect(byTestId(root, 'ai-apply')).toHaveLength(1);
    await fire(one(root, 'ai-apply'), 'onPress');
    await p;
    await settle();
    expect(result).toMatchObject({ message: 'Beautify: 1 change applied' });
    expect(byTestId(root, 'ai-close')).toHaveLength(0);
    await unmount(root);
  });

  it('the X button is a cancel', async () => {
    const w = await flowWorld();
    const root = await render(<AiFlowHost flow={w.ui.flow} ports={ports} />);
    const p = w.ui.flow.start(w.ctx(), true).catch((e: unknown) => e);
    await settle();
    await fire(one(root, 'ai-close'), 'onPress');
    expect(await p).toMatchObject({ code: 'cancelled' });
    await unmount(root);
  });

  it('the under-18 panel is calm: one Done button, no prompts', async () => {
    const w = await flowWorld({ adult: false });
    const root = await render(<AiFlowHost flow={w.ui.flow} ports={ports} />);
    const p = w.ui.flow.start(w.ctx(), true).catch(() => undefined);
    await settle();
    expect(byTestId(root, 'ai-minor')).toHaveLength(1);
    expect(byTestId(root, 'ai-minor-recheck')).toHaveLength(0);
    expect(allText(root)).toContain('Beautify Lite');
    await fire(one(root, 'ai-minor-ok'), 'onPress');
    await p;
    await unmount(root);
  });

  it('shows DEMO on every step when Demo AI is on', async () => {
    const w = await flowWorld({ isDev: true });
    await w.ui.gate.setFakeMode(true);
    const root = await render(<AiFlowHost flow={w.ui.flow} ports={ports} />);
    const p = w.ui.flow.start(w.ctx(), true).catch(() => undefined);
    await settle();
    expect(allText(root)).toContain('DEMO');
    expect(allText(root)).toContain(AI_EN['ai.demo.banner']);
    await fire(one(root, 'ai-close'), 'onPress');
    await p;
    await unmount(root);
  });
});
