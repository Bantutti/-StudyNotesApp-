/**
 * One message and ONE next step per error (Plan §9.6: "short, friendly,
 * specific, never blaming. Name the provider, give one next step").
 *
 * The message text comes from P3a's aiMessage (already provider-named and
 * content-free). This file only picks the next step.
 */
import { userMessage } from '@/core';
import { isAiError, type AiErrorKind, type Provider } from '@/modules/ai';

import type { ErrorView, NextStep } from './types';

/** Next step per error kind (Flow 4: Retry later, Replace key, Use Beautify Lite). */
const NEXT: Record<AiErrorKind, NextStep> = {
  missing_key: 'replace_key',
  invalid_key: 'replace_key',
  rate_limited: 'switch_provider', // falls back to 'ok' when no other provider has a key
  offline: 'beautify_lite',
  timeout: 'retry',
  provider_error: 'retry',
  too_large: 'select_part',
  invalid_output: 'retry',
  cancelled: 'ok',
  consent_required: 'ok',
  age_required: 'ok',
  blocked: 'ok',
  empty_scope: 'ok',
  stale: 'ok',
  invalid_input: 'ok',
  internal: 'ok',
};

export function errorView(e: unknown, switchTo: Provider | null): ErrorView {
  if (!isAiError(e)) return { kind: 'unknown', message: userMessage(e), next: 'ok', switchTo: null };
  let next = NEXT[e.kind];
  // "Switch provider" only makes sense when another provider has a key.
  if (next === 'switch_provider' && !switchTo) next = 'ok';
  // invalid_output after the engine's one automatic re-ask: say it plainly (Q6).
  const message = e.kind === 'invalid_output' ? invalidOutputMessage(e.providerLabel) : e.message;
  return { kind: e.kind, message, next, switchTo: next === 'switch_provider' ? switchTo : null };
}

function invalidOutputMessage(label: string | null): string {
  return `${label ?? 'The AI'}'s answer didn't make sense twice, so your note wasn't changed. Try again.`;
}
