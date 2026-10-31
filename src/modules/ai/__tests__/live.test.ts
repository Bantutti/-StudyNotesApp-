/**
 * @jest-environment ./src/modules/ai/__tests__/liveEnvironment.js
 */
/**
 * OPT-IN live check against the real providers (Rey runs it; Q10 = A).
 *
 * Skipped unless AI_LIVE=1. Keys come only from environment variables that
 * Rey sets in his PowerShell session from a masked prompt (docs/modules/ai.md,
 * "Live check"). Keys are never written to a file, printed or logged; the
 * test asserts that no log record contains them.
 *
 * What it checks per provider whose key is present:
 *  1. Test key -> ok (needs the key); a made-up key -> rejected (needs no key)
 *  2. Beautify on a sample note -> a schema-valid proposal that applies with
 *     every untouched block id kept, and undo restores the note exactly
 *  3. Make flashcards -> drafts in P2a card fields
 *  4. Quiz me -> valid questions
 *  5. The usage meter counted the requests
 */
import { listBlockIds } from '@/core';

import { createAiEngine } from '../engine';
import type { Provider } from '../keyFormat';
import { createKeyVault } from '../keyVault';
import { applyProposal, undoApply } from '../proposal/apply';
import { memFile, memStore, sampleDoc, seededIds, testLogger } from './fixtures';

const LIVE = process.env.AI_LIVE === '1';
const nativeFetch = (globalThis as unknown as { __nativeFetch?: typeof fetch }).__nativeFetch;
const KEYS: Record<Provider, string | undefined> = {
  groq: process.env.GROQ_API_KEY,
  mistral: process.env.MISTRAL_API_KEY,
};
const FAKE_KEYS: Record<Provider, string> = { groq: 'gsk_' + 'X'.repeat(52), mistral: 'Z'.repeat(32) };

const describeLive = LIVE ? describe : describe.skip;

describeLive.each(['groq', 'mistral'] as const)('LIVE %s', (provider) => {
  const key = KEYS[provider];
  const itKey = key ? it : it.skip;
  jest.setTimeout(180_000);

  async function engineWith(k: string) {
    if (!nativeFetch) throw new Error('native fetch missing: run through the live environment');
    const store = memStore();
    const vault = createKeyVault(store);
    await vault.set(provider, k);
    const { sink, logger } = testLogger();
    const file = memFile();
    const engine = createAiEngine({
      keyVault: vault,
      fetchFn: nativeFetch,
      logger,
      ids: seededIds(11),
      usageFile: file,
      gate: { isAdultConfirmed: async () => true, hasConsent: async () => true },
      timeoutMs: 60_000,
    });
    return { engine, sink, file };
  }

  // Needs no secret: the real server must answer a made-up key with 401.
  it('Test key rejects a made-up key, and a run reports "rejected by <provider>"', async () => {
    const fake = await engineWith(FAKE_KEYS[provider]);
    await expect(fake.engine.testKey(provider)).resolves.toEqual({ ok: false, reason: 'invalid_key' });
    const err = await fake.engine.run({ action: 'clarify', provider, doc: sampleDoc(), scope: { kind: 'note' }, aiAllowed: true }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'invalid_key', status: 401 });
    expect(JSON.stringify(fake.sink.records)).not.toContain(FAKE_KEYS[provider]);
  });

  itKey('Test key accepts the real key', async () => {
    const { engine, sink } = await engineWith(key as string);
    await expect(engine.testKey(provider)).resolves.toEqual({ ok: true });
    expect(JSON.stringify(sink.records)).not.toContain(key as string);
  });

  itKey('Beautify -> apply -> undo keeps block ids exact', async () => {
    const { engine, sink, file } = await engineWith(key as string);
    const before = sampleDoc();
    const prop = await engine.run({ action: 'beautify', provider, doc: before, scope: { kind: 'note' }, aiAllowed: true });
    expect(prop.models.length).toBeGreaterThan(0);
    const applied = applyProposal(before, prop, prop.changes.map((c) => c.changeId), seededIds(12));
    if (!applied.ok) throw applied.error;
    const after = new Set(listBlockIds(applied.value.doc));
    const removed = new Set(applied.value.removedBlockIds);
    for (const id of listBlockIds(before)) expect(after.has(id) || removed.has(id)).toBe(true);
    const undone = undoApply(applied.value.doc, applied.value.undo);
    expect(undone.ok && listBlockIds(undone.value)).toEqual(listBlockIds(before));
    expect(JSON.stringify(sink.records)).not.toContain(key as string);
    expect(file.content ?? '').not.toContain(key as string);
  });

  itKey('Make flashcards returns drafts in P2a card fields', async () => {
    const { engine } = await engineWith(key as string);
    const prop = await engine.run({ action: 'flashcards', provider, doc: sampleDoc(), scope: { kind: 'note' }, aiAllowed: true });
    expect(prop.cards.length).toBeGreaterThan(0);
    for (const c of prop.cards) {
      expect(['basic', 'reversed', 'cloze']).toContain(c.type);
      expect(c.source).toBe('ai');
      expect(c.front.length).toBeGreaterThan(0);
      expect(c.sourceBlockId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
  });

  itKey('Quiz me returns valid questions and the meter counts requests', async () => {
    const { engine } = await engineWith(key as string);
    const prop = await engine.run({ action: 'quiz', provider, doc: sampleDoc(), scope: { kind: 'note' }, aiAllowed: true });
    expect(prop.quiz.length).toBeGreaterThan(0);
    const today = await engine.usage.today(provider);
    expect(today.requests).toBeGreaterThanOrEqual(1);
  });
});

// Keeps the file a valid test suite when the live check is off.
it('live check is opt-in (AI_LIVE=1)', () => {
  expect(typeof LIVE).toBe('boolean');
});
