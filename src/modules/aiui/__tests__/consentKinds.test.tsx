/**
 * Separate, versioned consent per DATA KIND (Lead, Nov 1, for P5's vision
 * pass): a text "yes" never authorises images and vice versa; each kind has
 * its own catalog wording and version; v1 gate files migrate as text only;
 * the engine's note runs check the TEXT kind; checkCanSend takes the kind.
 */
import { AiError, CONSENT_KINDS, consentBlock, createAiEngine, PROVIDER_CATALOG, PROVIDERS, providersFor } from '@/modules/ai';

import { ConsentStep } from '../components/ConsentStep';
import { createGateStore } from '../gate/gateStore';
import { assertCanSend, checkCanSend } from '../gate/sendCheck';
import { flowWorld, flush, memoryFile, noteDoc, seededIds, spyLogger } from './helpers';
import { allText, fire, one, render, unmount } from './render';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const Glyph = ({ name }: { name: string }) => <Text>{`[${name}]`}</Text>;
  return { __esModule: true, default: Glyph };
});

const gate = (initial: string | null = null) => {
  const file = memoryFile(initial);
  return { file, g: createGateStore({ file, logger: spyLogger().logger, now: () => 1_000 }) };
};

const GROQ_IMAGE = PROVIDER_CATALOG.groq.imageConsent!;

describe('catalog', () => {
  it('Groq has its own versioned image consent wording', () => {
    const text = consentBlock('groq', 'text')!;
    const image = consentBlock('groq', 'image')!;
    expect(text).toBe(PROVIDER_CATALOG.groq.consent);
    expect(image).toBe(GROQ_IMAGE);
    expect(image.version).toBeGreaterThanOrEqual(1);
    expect(image.required).toBe(true);
    expect(image.recipient).toMatch(/Groq/);
    expect(image.dataSent).toMatch(/photo/i);
    expect(image.dataSent).toMatch(/no notes/i);
    expect(image.dataSent).not.toBe(text.dataSent);
    expect(image.purpose).not.toBe(text.purpose);
  });
  it('photos go to Groq only (Rey, Nov 1): Mistral has no image consent', () => {
    expect(PROVIDER_CATALOG.mistral.imageConsent).toBeNull();
    expect(consentBlock('mistral', 'image')).toBeNull();
    expect(providersFor('image')).toEqual(['groq']);
    expect(providersFor('text')).toEqual([...PROVIDERS]);
  });
  it('kinds are text and image', () => {
    expect([...CONSENT_KINDS]).toEqual(['text', 'image']);
  });
});

describe('gate store: kinds never cross', () => {
  it('text consent does not authorise images, and image consent does not authorise text', async () => {
    const { g } = gate();
    await g.giveConsent('groq', 1, 'text');
    expect(await g.hasConsent('groq', 1, 'text')).toBe(true);
    expect(await g.hasConsent('groq', 1, 'image')).toBe(false);
    await g.withdrawConsent('groq', 'text');
    await g.giveConsent('groq', 1, 'image');
    expect(await g.hasConsent('groq', 1, 'image')).toBe(true);
    expect(await g.hasConsent('groq', 1, 'text')).toBe(false);
  });

  it('versions are per kind, and withdraw removes only that kind', async () => {
    const { g } = gate();
    await g.giveConsent('groq', 1, 'text');
    await g.giveConsent('groq', 1, 'image');
    expect(await g.hasConsent('groq', 2, 'image')).toBe(false);
    await g.withdrawConsent('groq', 'image');
    expect(await g.consentVersion('groq', 'image')).toBeNull();
    expect(await g.consentVersion('groq', 'text')).toBe(1);
  });

  it('refuses image consent for Mistral, and a hand-edited file cannot grant it', async () => {
    const { g } = gate();
    await expect(g.giveConsent('mistral', 1, 'image')).rejects.toThrow('kind_not_supported');
    const forged = JSON.stringify({ v: 2, age: { adult: true, checkedAt: 1 }, consents: { image: { mistral: { version: 1, at: 1 } } }, defaultProvider: null, fakeMode: false });
    const { g: g2 } = gate(forged);
    expect(await g2.hasConsent('mistral', 1, 'image')).toBe(false);
  });

  it('rejects an unknown kind at runtime (no widening by typo)', async () => {
    const { g } = gate();
    await expect(g.giveConsent('groq', 1, 'audio' as never)).rejects.toThrow('bad_consent_kind');
    expect(await g.hasConsent('groq', 1, 'audio' as never)).toBe(false);
    expect(await g.hasConsent('groq', 1, undefined as never)).toBe(false);
  });

  it('a v1 file (text-only consents) migrates as TEXT consent, never image', async () => {
    const v1 = JSON.stringify({ v: 1, age: { adult: true, checkedAt: 5 }, consents: { groq: { version: 1, at: 5 } }, defaultProvider: 'groq', fakeMode: false });
    const { g, file } = gate(v1);
    expect(await g.isAdultConfirmed()).toBe(true);
    expect(await g.hasConsent('groq', 1, 'text')).toBe(true);
    expect(await g.hasConsent('groq', 1, 'image')).toBe(false);
    await g.setDefaultProvider('groq'); // next write saves v2
    expect(JSON.parse(file.content as string)).toMatchObject({ v: 2, consents: { text: { groq: { version: 1 } } } });
  });
});

describe('checkCanSend (the run check takes the kind)', () => {
  it('age first, then consent for that kind at the current catalog version', async () => {
    const { g } = gate();
    expect(await checkCanSend(g, { provider: 'groq', kind: 'image' })).toMatchObject({ ok: false, error: { kind: 'age_required' } });
    await g.recordAge(true);
    await g.giveConsent('groq', PROVIDER_CATALOG.groq.consent.version, 'text');
    expect(await checkCanSend(g, { provider: 'groq', kind: 'image' })).toMatchObject({ ok: false, error: { kind: 'consent_required' } });
    expect(await checkCanSend(g, { provider: 'groq', kind: 'text' })).toEqual({ ok: true, consentVersion: PROVIDER_CATALOG.groq.consent.version });
    await g.giveConsent('groq', GROQ_IMAGE.version, 'image');
    expect(await checkCanSend(g, { provider: 'groq', kind: 'image' })).toEqual({ ok: true, consentVersion: GROQ_IMAGE.version });
    await expect(assertCanSend(g, { provider: 'mistral', kind: 'image' })).rejects.toBeInstanceOf(AiError);
  });

  it('Mistral is refused for images before any other check (Groq only)', async () => {
    const { g } = gate();
    await g.recordAge(true);
    expect(await checkCanSend(g, { provider: 'mistral', kind: 'image' })).toMatchObject({ ok: false, error: { kind: 'invalid_input', reason: 'kind_not_supported' } });
    await g.giveConsent('mistral', 1, 'text');
    expect(await checkCanSend(g, { provider: 'mistral', kind: 'image' })).toMatchObject({ ok: false, error: { reason: 'kind_not_supported' } });
    expect(await checkCanSend(g, { provider: 'mistral', kind: 'text' })).toMatchObject({ ok: true });
  });

  it('under 18 and a blocked subject are refused regardless of consent', async () => {
    const { g } = gate();
    await g.recordAge(false);
    await g.giveConsent('groq', 1, 'image');
    expect(await checkCanSend(g, { provider: 'groq', kind: 'image' })).toMatchObject({ ok: false, error: { kind: 'age_required' } });
    await g.recordAge(true);
    await g.giveConsent('groq', 1, 'text');
    expect(await checkCanSend(g, { provider: 'groq', kind: 'text', aiAllowed: false })).toMatchObject({ ok: false, error: { kind: 'blocked' } });
  });
});

describe('engine and flow use the TEXT kind', () => {
  it('an image consent alone does not let a note be sent', async () => {
    const w = await flowWorld({ adult: true, groqKey: true });
    await w.ui.gate.giveConsent('groq', 1, 'image');
    const p = w.ui.flow.start(w.ctx(), true).catch(() => undefined);
    await flush();
    await w.ui.flow.chooseAction('beautify');
    expect(w.ui.flow.getSnapshot().step.name).toBe('consent'); // still asks for TEXT consent
    expect(w.groq.calls).toHaveLength(0);
    await w.ui.flow.answerConsent(true);
    await flush();
    expect(await w.ui.gate.hasConsent('groq', 1, 'text')).toBe(true);
    expect(w.ui.flow.getSnapshot().step.name).toBe('preview');
    w.ui.flow.close();
    await p;
  });

  it('the engine asks the gate for kind "text"', async () => {
    const asked: string[] = [];
    const w = await flowWorld({ groqKey: true });
    const engine = createAiEngine({
      keyVault: w.vault,
      fetchFn: w.fetchFn as unknown as typeof fetch,
      logger: w.log.logger,
      ids: seededIds(),
      usageFile: memoryFile(),
      gate: { isAdultConfirmed: async () => true, hasConsent: async (_p, _v, kind) => (asked.push(kind), false) },
      providers: { groq: w.groq },
    });
    await expect(engine.run({ action: 'beautify', provider: 'groq', doc: noteDoc(), scope: { kind: 'note' }, aiAllowed: true })).rejects.toMatchObject({ kind: 'consent_required' });
    expect(asked).toEqual(['text']);
  });
});

describe('ConsentStep kind="image" (reusable by P5)', () => {
  it('Mistral cannot be asked for photo consent: no Yes button', async () => {
    const root = await render(<ConsentStep provider="mistral" kind="image" busy={false} ports={{ openLink: jest.fn() }} onAnswer={() => undefined} />);
    expect(allText(root)).toContain('Mistral isn’t used for photos');
    expect(root.container.queryAll((n) => n.props.testID === 'ai-consent-yes')).toHaveLength(0);
    await unmount(root);
  });

  it('shows the image wording, not the text wording', async () => {
    const answers: boolean[] = [];
    const root = await render(<ConsentStep provider="groq" kind="image" busy={false} ports={{ openLink: jest.fn() }} onAnswer={(y) => answers.push(y)} />);
    const text = allText(root);
    expect(text).toContain(GROQ_IMAGE.dataSent);
    expect(text).not.toContain(PROVIDER_CATALOG.groq.consent.dataSent);
    expect(text).toContain('Send photos to Groq?');
    expect(text).toContain('Yes, send photos to Groq');
    await fire(one(root, 'ai-consent-yes'), 'onPress');
    expect(answers).toEqual([true]);
    await unmount(root);
  });
});
