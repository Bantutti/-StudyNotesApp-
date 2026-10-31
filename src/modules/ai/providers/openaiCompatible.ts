/**
 * Adapter for providers that speak the OpenAI-style Chat Completions API.
 * Groq (https://api.groq.com/openai/v1) and Mistral (https://api.mistral.ai/v1)
 * both do, so one adapter serves both with a small per-provider config.
 *
 * Request parameters used, from the providers' docs (checked 2026-11-01):
 * - Groq: max_completion_tokens; response_format { type: 'json_schema',
 *   json_schema: { name, schema, strict: true } } (strict mode is supported
 *   on gpt-oss-20b/120b); gpt-oss reasoning: reasoning_effort 'low' and
 *   include_reasoning false (reasoning tokens count as output tokens, and we
 *   don't need them back).
 * - Mistral: max_tokens; response_format { type: 'json_schema', json_schema:
 *   { name, schema, strict: true } }. The docs page shows type 'json_schema'
 *   but not the nested field names; we use the OpenAI convention, which
 *   Mistral's SDK follows. The opt-in live test confirms it (docs/modules/ai.md).
 *
 * Security: the key is fetched per call from the KeyVault and only placed in
 * the Authorization header by transport/http.ts. Responses are validated
 * with zod here (shape) and again by the engine (content).
 */
import * as z from 'zod';

import type { Logger } from '@/core';

import { AiError } from '../errors';
import type { Provider } from '../keyFormat';
import { httpJson } from '../transport/http';
import { PROVIDER_CATALOG } from './catalog';
import type { ChatProvider, ChatRequest, ChatResult, KeyTestResult } from './types';

export interface OpenAiCompatibleConfig {
  id: Provider;
  /** Name of the max-output parameter for this provider. */
  maxTokensParam: 'max_completion_tokens' | 'max_tokens';
  /** Extra body fields for a given model (e.g. gpt-oss reasoning controls). */
  extraBody: (model: string) => Record<string, unknown>;
}

export const GROQ_CONFIG: OpenAiCompatibleConfig = {
  id: 'groq',
  maxTokensParam: 'max_completion_tokens',
  extraBody: (model) => (model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
};

export const MISTRAL_CONFIG: OpenAiCompatibleConfig = {
  id: 'mistral',
  maxTokensParam: 'max_tokens',
  extraBody: () => ({}),
};

export interface AdapterDeps {
  getKey: () => Promise<string | null>;
  fetchFn: typeof fetch;
  logger: Logger;
  now?: () => number;
  /** Per-request timeout for chat calls (default 30 s, Plan §7 table). */
  timeoutMs?: number;
  /** Timeout for the Test key call (default 15 s). */
  testTimeoutMs?: number;
}

export const CHAT_TIMEOUT_MS = 30_000;
export const TEST_TIMEOUT_MS = 15_000;

/** The parts of a chat completion we use. Extra fields are ignored (stripped). */
const completionSchema = z.object({
  model: z.string().max(200).optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().max(400_000).nullable().optional() }),
        finish_reason: z.string().max(40).nullable().optional(),
      }),
    )
    .min(1)
    .max(4),
  usage: z
    .object({
      prompt_tokens: z.number().int().min(0).max(10_000_000),
      completion_tokens: z.number().int().min(0).max(10_000_000),
    })
    .nullable()
    .optional(),
});

export function createOpenAiCompatibleProvider(cfg: OpenAiCompatibleConfig, deps: AdapterDeps): ChatProvider {
  const info = PROVIDER_CATALOG[cfg.id];
  const now = deps.now ?? Date.now;
  const log = deps.logger.child(cfg.id);

  // Reads the key at call time; it is never cached in this closure.
  const requireKey = async (): Promise<string> => {
    const key = await deps.getKey();
    if (!key) throw new AiError('missing_key', { providerLabel: info.label });
    return key;
  };

  return {
    id: cfg.id,

    async complete(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
      const apiKey = await requireKey();
      const body = {
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        temperature: req.temperature,
        [cfg.maxTokensParam]: req.maxOutputTokens,
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true },
        },
        stream: false,
        ...cfg.extraBody(req.model),
      };
      const t0 = now();
      const res = await httpJson({
        fetchFn: deps.fetchFn,
        url: `${info.apiBase}/chat/completions`,
        method: 'POST',
        apiKey,
        body,
        timeoutMs: deps.timeoutMs ?? CHAT_TIMEOUT_MS,
        signal,
        providerLabel: info.label,
        now,
      });
      const parsed = completionSchema.safeParse(res.json);
      if (!parsed.success) {
        throw new AiError('provider_error', { providerLabel: info.label, status: res.status, reason: 'unexpected_shape' });
      }
      const choice = parsed.data.choices[0];
      const content = choice?.message.content ?? '';
      const usage = parsed.data.usage
        ? { inputTokens: parsed.data.usage.prompt_tokens, outputTokens: parsed.data.usage.completion_tokens, estimated: false }
        : null;
      // Numbers only: never the content, never the key.
      log.info('chat_ok', { ms: now() - t0, status: res.status, inTok: usage?.inputTokens ?? -1, outTok: usage?.outputTokens ?? -1 });
      return {
        content,
        model: parsed.data.model ?? req.model,
        usage,
        rate: res.rate,
        finishReason: choice?.finish_reason ?? null,
      };
    },

    async testKey(signal?: AbortSignal): Promise<KeyTestResult> {
      const key = await deps.getKey();
      if (!key) return { ok: false, reason: 'missing_key' };
      try {
        await httpJson({
          fetchFn: deps.fetchFn,
          url: `${info.apiBase}/models`,
          method: 'GET',
          apiKey: key,
          timeoutMs: deps.testTimeoutMs ?? TEST_TIMEOUT_MS,
          signal,
          providerLabel: info.label,
          now,
        });
        log.info('test_key', { result: 'ok' });
        return { ok: true };
      } catch (e) {
        if (e instanceof AiError && e.kind === 'invalid_key') {
          log.info('test_key', { result: 'rejected' });
          return { ok: false, reason: 'invalid_key' };
        }
        throw e; // offline, timeout, 5xx: the key may be fine; the UI says so
      }
    },
  };
}
