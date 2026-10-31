/**
 * Scripted fake provider for tests and for P3b's developer mode.
 *
 * Each call to complete() consumes the next step of the script:
 * - { json }    -> answers with JSON.stringify(json) as the content
 * - { content } -> answers with this exact raw text (for invalid-output tests)
 * - { error }   -> throws that AiError (rate limit, bad key, offline, ...)
 * - a function  -> computes the step from the request (e.g. echo the refs)
 * When the script runs out, the last step repeats.
 *
 * The fake never sees a key: tests assert this through `calls`.
 */
import { AiError } from '../errors';
import type { Provider } from '../keyFormat';
import type { ChatProvider, ChatRequest, ChatResult, KeyTestResult } from './types';

export type FakeStep =
  | { json: unknown; usage?: { inputTokens: number; outputTokens: number }; finishReason?: string }
  | { content: string; finishReason?: string }
  | { error: AiError }
  | ((req: ChatRequest, callIndex: number) => FakeStep);

export interface FakeProvider extends ChatProvider {
  /** Every request the engine sent, in order (for assertions). */
  readonly calls: { req: ChatRequest; aborted: boolean }[];
  /** Replace the script mid-test. */
  setScript(steps: FakeStep[]): void;
  /** Result of testKey(). */
  keyTest: KeyTestResult | AiError;
}

export function createFakeProvider(id: Provider, steps: FakeStep[] = []): FakeProvider {
  let script = steps;
  let index = 0;
  const calls: { req: ChatRequest; aborted: boolean }[] = [];

  const resolveStep = (req: ChatRequest, i: number): Exclude<FakeStep, (...a: never[]) => unknown> => {
    let step = script[Math.min(i, script.length - 1)];
    if (step === undefined) throw new AiError('internal', { reason: 'fake_script_empty' });
    while (typeof step === 'function') step = step(req, i);
    return step;
  };

  const fake: FakeProvider = {
    id,
    calls,
    keyTest: { ok: true },
    setScript(next) {
      script = next;
      index = 0;
    },
    async complete(req, signal): Promise<ChatResult> {
      calls.push({ req, aborted: signal?.aborted ?? false });
      if (signal?.aborted) throw new AiError('cancelled');
      const step = resolveStep(req, index++);
      if ('error' in step) throw step.error;
      const content = 'json' in step ? JSON.stringify(step.json) : step.content;
      const usage = 'json' in step && step.usage ? { ...step.usage, estimated: false } : null;
      return {
        content,
        model: req.model,
        usage,
        rate: { remainingRequests: null, resetRequestsMs: null, remainingTokens: null },
        finishReason: step.finishReason ?? 'stop',
      };
    },
    async testKey() {
      if (fake.keyTest instanceof AiError) throw fake.keyTest;
      return fake.keyTest;
    },
  };
  return fake;
}
