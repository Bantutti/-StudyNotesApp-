/**
 * The two small engine additions P3b needed:
 * - testKey(provider, signal, candidateKey): tests a NEW key without storing
 *   it, sending only that key, to the provider's fixed host;
 * - usage.reload(): drops the in-memory copy (Delete all data).
 */
import { createAiEngine } from '../engine';
import { GROQ_KEY, jsonResponse, memFile, seededIds, testLogger, vaultWithKeys } from './fixtures';

const CANDIDATE = 'gsk_' + 'New1'.repeat(12);

async function setup(status: number) {
  const { vault, store } = await vaultWithKeys();
  const calls: { url: string; auth: string }[] = [];
  const fetchFn = jest.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), auth: String((init?.headers as Record<string, string>).Authorization) });
    return jsonResponse(status, status === 200 ? { data: [] } : { error: { message: 'bad key' } });
  });
  const { sink, logger } = testLogger();
  const file = memFile();
  const engine = createAiEngine({
    keyVault: vault,
    fetchFn: fetchFn as unknown as typeof fetch,
    logger,
    ids: seededIds(1),
    usageFile: file,
    gate: { isAdultConfirmed: async () => true, hasConsent: async () => true },
  });
  return { engine, vault, store, calls, sink, file };
}

describe('testKey with a candidate key', () => {
  it('sends only the candidate, to the fixed host, and stores nothing', async () => {
    const { engine, vault, calls } = await setup(200);
    await expect(engine.testKey('groq', undefined, `  ${CANDIDATE} `)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{ url: 'https://api.groq.com/openai/v1/models', auth: `Bearer ${CANDIDATE}` }]);
    expect(await vault.get('groq')).toBe(GROQ_KEY); // unchanged
  });

  it('a rejected candidate leaves the stored key alone', async () => {
    const { engine, vault } = await setup(401);
    await expect(engine.testKey('groq', undefined, CANDIDATE)).resolves.toEqual({ ok: false, reason: 'invalid_key' });
    expect(await vault.get('groq')).toBe(GROQ_KEY);
  });

  it('a malformed candidate is refused without a request', async () => {
    const { engine, calls } = await setup(200);
    await expect(engine.testKey('groq', undefined, 'not a key')).resolves.toEqual({ ok: false, reason: 'invalid_key' });
    expect(calls).toHaveLength(0);
  });

  it('never logs the candidate', async () => {
    const { engine, sink } = await setup(401);
    await engine.testKey('groq', undefined, CANDIDATE);
    expect(JSON.stringify(sink.records)).not.toContain(CANDIDATE.slice(4));
  });

  it('without a candidate, the stored key is tested (unchanged P3a behaviour)', async () => {
    const { engine, calls } = await setup(200);
    await engine.testKey('groq');
    expect(calls[0]?.auth).toBe(`Bearer ${GROQ_KEY}`);
  });
});

describe('usage.reload()', () => {
  it('re-reads the file on the next call', async () => {
    const { engine, file } = await setup(200);
    await engine.usage.record({ provider: 'groq', model: 'openai/gpt-oss-120b', ok: true, inputTokens: 1, outputTokens: 1, estimated: false });
    expect((await engine.usage.today('groq')).requests).toBe(1);
    file.content = null; // the ai folder was deleted
    expect((await engine.usage.today('groq')).requests).toBe(1); // still cached
    engine.usage.reload();
    expect((await engine.usage.today('groq')).requests).toBe(0);
  });
});
