/**
 * Real adapters against a mocked fetch: request shape per provider, response
 * parsing, Test key, and the security rule that the key never appears in
 * logs, the usage file, the proposal or error messages (exit criterion).
 */
import { createAiEngine } from '../engine';
import { createKeyVault } from '../keyVault';
import { normalizeKey } from '../keyFormat';
import { PROVIDER_CATALOG } from '../providers/catalog';
import { createOpenAiCompatibleProvider, GROQ_CONFIG, MISTRAL_CONFIG } from '../providers/openaiCompatible';
import { completion, GROQ_KEY, jsonResponse, memFile, memStore, MISTRAL_KEY, sampleDoc, seededIds, testLogger, vaultWithKeys } from './fixtures';

const req = {
  model: 'openai/gpt-oss-120b',
  system: 'sys',
  user: 'usr',
  schemaName: 'edit_plan',
  jsonSchema: { type: 'object' },
  maxOutputTokens: 1_000,
  temperature: 0.3,
};

describe('OpenAI-compatible adapter', () => {
  it('Groq: fixed URL, max_completion_tokens, strict json_schema, low reasoning', async () => {
    const { logger } = testLogger();
    const fetchFn = jest.fn(async () => jsonResponse(200, completion({ units: [] }), { 'x-ratelimit-remaining-requests': '998' }));
    const a = createOpenAiCompatibleProvider(GROQ_CONFIG, { getKey: async () => GROQ_KEY, fetchFn, logger });
    const r = await a.complete(req);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'openai/gpt-oss-120b',
      max_completion_tokens: 1_000,
      temperature: 0.3,
      stream: false,
      reasoning_effort: 'low',
      include_reasoning: false,
      response_format: { type: 'json_schema', json_schema: { name: 'edit_plan', strict: true, schema: { type: 'object' } } },
    });
    expect(body.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }]);
    expect(r).toMatchObject({ content: '{"units":[]}', usage: { inputTokens: 120, outputTokens: 80, estimated: false }, rate: { remainingRequests: 998 } });
  });

  it('Mistral: its own host and max_tokens, no reasoning fields', async () => {
    const { logger } = testLogger();
    const fetchFn = jest.fn(async () => jsonResponse(200, completion({ units: [] }, undefined, 'mistral-small-latest')));
    const a = createOpenAiCompatibleProvider(MISTRAL_CONFIG, { getKey: async () => MISTRAL_KEY, fetchFn, logger });
    await a.complete({ ...req, model: 'mistral-small-latest' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBe(1_000);
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('rejects unexpected response shapes and reports missing keys', async () => {
    const { logger } = testLogger();
    const bad = createOpenAiCompatibleProvider(GROQ_CONFIG, { getKey: async () => GROQ_KEY, fetchFn: async () => jsonResponse(200, { choices: [] }), logger });
    await expect(bad.complete(req)).rejects.toMatchObject({ kind: 'provider_error', reason: 'unexpected_shape' });
    const none = createOpenAiCompatibleProvider(GROQ_CONFIG, { getKey: async () => null, fetchFn: jest.fn(), logger });
    await expect(none.complete(req)).rejects.toMatchObject({ kind: 'missing_key', message: 'Add a free Groq key to use AI.' });
    await expect(none.testKey()).resolves.toEqual({ ok: false, reason: 'missing_key' });
  });

  it('Test key: GET /models; 401 means rejected, network errors are thrown', async () => {
    const { logger } = testLogger();
    const ok = jest.fn(async () => jsonResponse(200, { data: [] }));
    const a = createOpenAiCompatibleProvider(MISTRAL_CONFIG, { getKey: async () => MISTRAL_KEY, fetchFn: ok, logger });
    await expect(a.testKey()).resolves.toEqual({ ok: true });
    expect((ok.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('https://api.mistral.ai/v1/models');
    expect((ok.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('GET');
    const rejected = createOpenAiCompatibleProvider(MISTRAL_CONFIG, { getKey: async () => MISTRAL_KEY, fetchFn: async () => jsonResponse(401, {}), logger });
    await expect(rejected.testKey()).resolves.toEqual({ ok: false, reason: 'invalid_key' });
    const down = createOpenAiCompatibleProvider(MISTRAL_CONFIG, { getKey: async () => MISTRAL_KEY, fetchFn: async () => Promise.reject(new TypeError('fail')), logger });
    await expect(down.testKey()).rejects.toMatchObject({ kind: 'offline' });
  });
});

describe('keys', () => {
  it('Mistral keys: loose format check, separate vault slot', async () => {
    expect(normalizeKey('mistral', ` ${MISTRAL_KEY}\n`)).toEqual({ ok: true, value: MISTRAL_KEY });
    expect(normalizeKey('mistral', GROQ_KEY).ok).toBe(false); // underscore: a Groq key pasted in the wrong place
    expect(normalizeKey('mistral', 'https://console.mistral.ai').ok).toBe(false);
    const store = memStore();
    await createKeyVault(store).set('mistral', MISTRAL_KEY);
    expect([...store.data.keys()]).toEqual(['ai.mistral.apiKey']);
  });

  it('catalog: 18+ everywhere, Mistral tells users to turn off training', () => {
    expect(PROVIDER_CATALOG.groq.minAge).toBe(18);
    expect(PROVIDER_CATALOG.mistral.minAge).toBe(18);
    expect(PROVIDER_CATALOG.mistral.dataUse.mayTrainOnFreeTier).toBe(true);
    // New path (Mistral Help Center, dated 2026-09-03): Admin panel -> Privacy -> "Anonymous improvement data".
    expect(PROVIDER_CATALOG.mistral.dataUse.privacyStep).toMatch(/Admin panel, open Privacy.*"Anonymous improvement data"/);
    expect(PROVIDER_CATALOG.mistral.dataUse.privacyStep).toMatch(/separate from the Vibe/);
    expect(PROVIDER_CATALOG.mistral.dataUse.privacyStep).not.toMatch(/open API/);
    expect(PROVIDER_CATALOG.mistral.dataUse.privacyStepSource).toEqual({
      url: 'https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training',
      dated: '2026-09-03',
    });
    expect(PROVIDER_CATALOG.groq.models).toEqual({ primary: 'openai/gpt-oss-120b', fallbacks: ['openai/gpt-oss-20b'] });
    for (const p of Object.values(PROVIDER_CATALOG)) {
      expect(p.apiBase.startsWith('https://')).toBe(true);
      // Apple 5.1.2(i): every provider needs an explicit, versioned, per-provider "yes" with full disclosure.
      expect(p.consent.required).toBe(true);
      expect(Number.isInteger(p.consent.version) && p.consent.version >= 1).toBe(true);
      for (const field of [p.consent.recipient, p.consent.dataSent, p.consent.purpose]) expect(field.trim().length).toBeGreaterThan(0);
      expect(p.consent.dataSent).toMatch(/API key/);
    }
  });
});

describe('SECURITY: the key never leaves the vault except in the Authorization header', () => {
  it.each([
    ['groq', GROQ_KEY],
    ['mistral', MISTRAL_KEY],
  ] as const)('%s: not in logs, usage file, proposal or errors, on success and on every failure path', async (provider, key) => {
    const { vault } = await vaultWithKeys();
    const { sink, logger } = testLogger();
    const file = memFile();
    const seenAuth: string[] = [];
    // Each call takes the next behaviour; the list cycles. Covers success,
    // 401, a long 429, 5xx and offline.
    const behaviours: (() => Response)[] = [
      () => jsonResponse(200, completion({ units: [{ ref: 'u2', op: 'replace', blocks: [{ kind: 'paragraph', term: null, text: `echo ${key}` }] }] })),
      () => jsonResponse(401, { error: { message: `bad key ${key}` } }),
      () => jsonResponse(429, { error: key }, { 'retry-after': '3600' }),
      () => jsonResponse(500, { error: key }),
      () => {
        throw new TypeError(`offline ${key}`);
      },
    ];
    let i = 0;
    const fetchFn = jest.fn(async (_url: string, init?: RequestInit) => {
      seenAuth.push((init?.headers as Record<string, string>).Authorization ?? '');
      const b = behaviours[i++ % behaviours.length] as () => Response;
      return b();
    });
    const engine = createAiEngine({
      keyVault: vault,
      fetchFn: fetchFn as unknown as typeof fetch,
      logger,
      ids: seededIds(5),
      usageFile: file,
      gate: { isAdultConfirmed: async () => true, hasConsent: async () => true },
      sleep: async () => undefined,
      random: () => 0,
    });
    const runOnce = () => engine.run({ action: 'clarify', provider, doc: sampleDoc(), scope: { kind: 'note' }, aiAllowed: true });

    const outputs: unknown[] = [];
    outputs.push(await runOnce().catch((e: unknown) => e)); // success (AI echoed the key into the note text!)
    for (let n = 0; n < 6; n++) outputs.push(await runOnce().catch((e: unknown) => e)); // 401, 429, 500s, offline
    outputs.push(await engine.testKey(provider).catch((e: unknown) => e));

    expect(seenAuth.every((a) => a === `Bearer ${key}`)).toBe(true);
    const logged = JSON.stringify(sink.records);
    expect(logged).not.toContain(key);
    expect(logged).not.toContain(key.slice(4, 20));
    expect(file.content ?? '').not.toContain(key);
    for (const o of outputs) {
      // The only place the key may appear is note text the AI itself wrote
      // (the user-visible diff); never in metadata or error messages.
      const meta = JSON.stringify(o ?? null, (k, v) => (k === 'after' || k === 'before' ? undefined : v));
      expect(meta).not.toContain(key);
      if (o instanceof Error) expect(o.message).not.toContain(key);
    }
  });
});
