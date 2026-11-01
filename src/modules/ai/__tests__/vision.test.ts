/**
 * P5 M6: engine.describeImages (Groq vision, Match a look). Gates, request
 * shape, validation with one re-ask, and no photo data in logs.
 */
import * as z from 'zod';

import { createAiEngine, type AiGatePort } from '../engine';
import { isAiError } from '../errors';
import { MAX_IMAGE_BASE64 } from '../providers/openaiCompatible';
import { PROVIDER_CATALOG } from '../providers/catalog';
import { jsonResponse, memFile, seededIds, testLogger, vaultWithKeys } from './fixtures';

const IMG = '/9j/' + 'QUJD'.repeat(200); // a base64 string shaped like a JPEG
const schema = z.strictObject({ bullet: z.enum(['dot', 'star', 'unsure']) });
const req = (over: Partial<Parameters<ReturnType<typeof createAiEngine>['describeImages']>[0]> = {}) => ({
  provider: 'groq' as const,
  images: [IMG],
  system: 'Describe the design.',
  user: 'Pick values.',
  schemaName: 'note_design',
  jsonSchema: { type: 'object', additionalProperties: false, required: ['bullet'], properties: { bullet: { type: 'string', enum: ['dot', 'star', 'unsure'] } } },
  schema,
  maxOutputTokens: 200,
  ...over,
});

/** Gate that remembers what it was asked. */
function gate(opts: { adult?: boolean; consents?: { kind: string; version: number }[] } = {}): AiGatePort & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    isAdultConfirmed: async () => opts.adult ?? true,
    hasConsent: async (provider, version, kind) => {
      asked.push(`${provider}:${kind}:${version}`);
      return (opts.consents ?? [{ kind: 'image', version: 1 }]).some((c) => c.kind === kind && c.version === version);
    },
  };
}

async function setup(answers: string[], g = gate()) {
  const { vault } = await vaultWithKeys();
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const fetchFn = jest.fn(async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const content = answers.shift() ?? '{}';
    return jsonResponse(200, { model: 'qwen/qwen3.8-27b', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 2400, completion_tokens: 20 } });
  });
  const { sink, logger } = testLogger();
  const engine = createAiEngine({ keyVault: vault, fetchFn: fetchFn as unknown as typeof fetch, logger, ids: seededIds(3), usageFile: memFile(), gate: g });
  return { engine, bodies, urls, sink, g, vault };
}

describe('engine.describeImages', () => {
  it('sends the photos to Groq qwen/qwen3.8-27b as image parts with strict JSON output and no reasoning text', async () => {
    const { engine, bodies, urls } = await setup(['{"bullet":"star"}']);
    await expect(engine.describeImages(req())).resolves.toEqual({ bullet: 'star' });
    expect(urls).toEqual(['https://api.groq.com/openai/v1/chat/completions']);
    const body = bodies[0] as { model: string; messages: { role: string; content: unknown }[]; response_format: { type: string; json_schema: { strict: boolean } }; reasoning_effort: string; reasoning_format: string };
    expect(body.model).toBe('qwen/qwen3.8-27b');
    expect(body.reasoning_effort).toBe('none');
    expect(body.reasoning_format).toBe('hidden');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    const user = body.messages[1]!.content as { type: string; image_url?: { url: string } }[];
    expect(user[0]).toEqual({ type: 'text', text: 'Pick values.' });
    expect(user[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${IMG}` } });
  });

  it('checks the IMAGE consent at the catalog version: a text consent never authorises photos', async () => {
    const g = gate({ consents: [{ kind: 'text', version: 1 }] });
    const { engine, urls } = await setup(['{"bullet":"dot"}'], g);
    await expect(engine.describeImages(req())).rejects.toMatchObject({ kind: 'consent_required' });
    expect(g.asked).toEqual([`groq:image:${PROVIDER_CATALOG.groq.imageConsent!.version}`]);
    expect(urls).toEqual([]);
  });

  it('refuses an old image consent version, a minor, a missing key, and Mistral', async () => {
    const old = await setup([], gate({ consents: [{ kind: 'image', version: 0 }] }));
    await expect(old.engine.describeImages(req())).rejects.toMatchObject({ kind: 'consent_required' });
    const minor = await setup([], gate({ adult: false }));
    await expect(minor.engine.describeImages(req())).rejects.toMatchObject({ kind: 'age_required' });
    const nokey = await setup([]);
    await nokey.vault.remove('groq');
    await expect(nokey.engine.describeImages(req())).rejects.toMatchObject({ kind: 'missing_key' });
    const mistral = await setup([]);
    await expect(mistral.engine.describeImages(req({ provider: 'mistral' }))).rejects.toMatchObject({ kind: 'invalid_input' });
    for (const s of [old, minor, nokey, mistral]) expect(s.urls).toEqual([]);
  });

  it('refuses 0 or more than 3 images, and oversized or non-base64 images, before sending', async () => {
    const { engine, urls } = await setup([]);
    await expect(engine.describeImages(req({ images: [] }))).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(engine.describeImages(req({ images: [IMG, IMG, IMG, IMG] }))).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(engine.describeImages(req({ images: ['A'.repeat(MAX_IMAGE_BASE64 + 4)] }))).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(engine.describeImages(req({ images: ['not base64 <svg>'] }))).rejects.toMatchObject({ kind: 'invalid_input' });
    expect(urls).toEqual([]);
  });

  it('re-asks once on an invalid answer, then gives up with invalid_output', async () => {
    const ok = await setup(['{"bullet":"heart","css":"x"}', '{"bullet":"dot"}']);
    await expect(ok.engine.describeImages(req())).resolves.toEqual({ bullet: 'dot' });
    expect(ok.bodies).toHaveLength(2);
    const bad = await setup(['not json', '{"bullet":"url(https://evil)"}']);
    const e = await bad.engine.describeImages(req()).catch((x: unknown) => x);
    expect(isAiError(e) && e.kind).toBe('invalid_output');
    expect(bad.bodies).toHaveLength(2);
  });

  it('never logs the photos, the prompt or the answer', async () => {
    const { engine, sink } = await setup(['{"bullet":"star"}']);
    await engine.describeImages(req());
    const logs = JSON.stringify(sink.records);
    expect(logs).not.toContain('QUJD');
    expect(logs).not.toContain('Pick values');
    expect(logs).not.toContain('star');
  });
});
