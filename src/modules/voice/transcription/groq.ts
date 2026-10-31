/**
 * Groq Whisper adapter.
 *
 * Security:
 * - The key comes from the KeyVault (device secure storage) per call and is
 *   sent only to the fixed Groq host over HTTPS. It is never logged.
 * - The endpoint is a constant; nothing user-controlled builds the URL.
 * - Responses are schema-validated and bounded before use.
 * - Error bodies are never read into logs or messages (they can echo input).
 */
import * as z from 'zod';

import { AppError, type Logger } from '@/core';

import { MAX_PROMPT_CHARS, type Transcript, type TranscriptionProvider, type TranscriptionRequest } from './types';

export const GROQ_BASE = 'https://api.groq.com/openai/v1';
export const GROQ_MODEL = 'whisper-large-v3-turbo';
/** Free-tier upload limit (25 MB); we use decimal MB to stay safely below it. */
export const GROQ_MAX_UPLOAD_BYTES = 25_000_000;
export const GROQ_TIMEOUT_MS = 180_000;

const responseSchema = z.object({
  text: z.string().max(500_000),
  language: z.string().max(40).optional().default(''),
  duration: z.number().nonnegative().optional().default(0),
  words: z
    .array(z.object({ word: z.string().max(200), start: z.number(), end: z.number() }))
    .max(100_000)
    .optional()
    .default([]),
  segments: z
    .array(z.object({ start: z.number(), end: z.number(), text: z.string().max(10_000) }))
    .max(20_000)
    .optional()
    .default([]),
});

export interface GroqDeps {
  getKey: () => Promise<string | null>;
  fetchFn: typeof fetch;
  fileSize: (uri: string) => number | null;
  logger: Logger;
  clock?: () => number;
  timeoutMs?: number;
}

function statusError(status: number): AppError {
  if (status === 401 || status === 403) return new AppError('invalid_key', 'Groq rejected the key. Check it in Settings.');
  if (status === 413) return new AppError('too_large', 'The audio file is too large for Groq (25 MB max).');
  if (status === 429) return new AppError('rate_limited', 'Groq rate limit reached. Wait a minute and try again.');
  if (status >= 500) return new AppError('provider_error', 'Groq is having problems. Try again later.');
  return new AppError('provider_error', `Groq returned an error (HTTP ${status}).`);
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } catch (e) {
    if (ctrl.signal.aborted) throw new AppError('timeout', 'Transcription timed out.');
    if (e instanceof AppError) throw e;
    throw new AppError('network', 'Could not reach Groq. Check your internet connection.');
  } finally {
    clearTimeout(timer);
  }
}

export function createGroqTranscriber(deps: GroqDeps): TranscriptionProvider {
  const clock = deps.clock ?? Date.now;
  const log = deps.logger.child('groq');
  const timeoutMs = deps.timeoutMs ?? GROQ_TIMEOUT_MS;

  const requireKey = async (): Promise<string> => {
    const key = await deps.getKey();
    if (!key) throw new AppError('missing_key', 'Add your Groq key in Settings first.');
    return key;
  };

  return {
    id: 'groq',
    maxUploadBytes: GROQ_MAX_UPLOAD_BYTES,

    async testKey() {
      const key = await requireKey();
      return withTimeout(15_000, async (signal) => {
        const res = await deps.fetchFn(`${GROQ_BASE}/models`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}` },
          signal,
        });
        log.info('test_key', { status: res.status });
        if (res.status === 401 || res.status === 403) return false;
        if (!res.ok) throw statusError(res.status);
        return true;
      });
    },

    async transcribe(req: TranscriptionRequest): Promise<Transcript> {
      if (!/^[A-Za-z0-9-]+\.(m4a|mp4|mp3|wav|webm)$/.test(req.fileName)) {
        throw new AppError('validation_failed', 'Unsupported audio file name.');
      }
      const size = deps.fileSize(req.fileUri);
      if (size === null) throw new AppError('not_found', 'The recording file is missing.');
      if (size > GROQ_MAX_UPLOAD_BYTES) throw new AppError('too_large', 'The audio file is larger than 25 MB.');
      const key = await requireKey();

      const form = new FormData();
      // React Native FormData accepts { uri, name, type } for file parts.
      form.append('file', { uri: req.fileUri, name: req.fileName, type: req.mimeType } as unknown as Blob);
      form.append('model', GROQ_MODEL);
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      form.append('timestamp_granularities[]', 'segment');
      form.append('temperature', '0');
      if (req.language) form.append('language', req.language);
      const prompt = (req.prompt ?? '').trim().slice(0, MAX_PROMPT_CHARS);
      if (prompt) form.append('prompt', prompt);

      const t0 = clock();
      const json = await withTimeout(timeoutMs, async (signal) => {
        const res = await deps.fetchFn(`${GROQ_BASE}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal,
        });
        if (!res.ok) {
          log.warn('transcribe_failed', { status: res.status });
          throw statusError(res.status);
        }
        return res.json() as Promise<unknown>;
      });
      const latencyMs = clock() - t0;

      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) throw new AppError('provider_error', 'Groq sent an unexpected response.');
      const r = parsed.data;
      log.info('transcribe_ok', { ms: latencyMs, words: r.words.length, bytes: size });
      return {
        text: r.text,
        language: r.language,
        durationSec: r.duration,
        words: r.words.map((w) => ({ word: w.word, start: w.start, end: w.end })),
        segments: r.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
        latencyMs,
      };
    },
  };
}
