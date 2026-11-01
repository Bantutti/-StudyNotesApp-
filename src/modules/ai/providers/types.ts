/**
 * Provider port: the only thing the engine knows about an AI provider.
 * Adapters: openaiCompatible (Groq, Mistral) and fake (tests, P3b dev mode).
 */
import type { Provider } from '../keyFormat';
import type { RateInfo } from '../transport/http';

export interface ChatRequest {
  model: string;
  /** Instructions (trusted, from our versioned prompts). */
  system: string;
  /** The note as delimited, escaped JSON data (untrusted) plus the task line. */
  user: string;
  /** Name + JSON Schema for structured output (keywords already reduced, §4.4). */
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  temperature: number;
  /**
   * P5 vision pass: clean, downsized JPEGs as base64 (lookmatch strips all
   * metadata first). Only sent with a model the catalog marks as vision.
   */
  images?: readonly string[];
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  /** True when the provider sent no usage and we used our estimate (§1.1). */
  estimated: boolean;
}

export interface ChatResult {
  /** The raw assistant text. Untrusted until parsed with zod. */
  content: string;
  /** Model id the provider reports having used. */
  model: string;
  usage: ChatUsage | null;
  rate: RateInfo;
  /** 'length' means the answer was cut off by maxOutputTokens. */
  finishReason: string | null;
}

export type KeyTestResult = { ok: true } | { ok: false; reason: 'invalid_key' | 'missing_key' };

export interface ChatProvider {
  readonly id: Provider;
  /** Throws AiError on any failure (see transport/http.ts). */
  complete(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult>;
  /** Cheap, read-only authenticated call (GET /models). */
  testKey(signal?: AbortSignal): Promise<KeyTestResult>;
}
