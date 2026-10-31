/**
 * AI errors: one class for every failure the AI engine can report.
 *
 * Why a subclass instead of new core codes: core's ErrorCode is shared and
 * owned by P1, and P3a must not change it. AiError extends AppError so every
 * existing `errorCode()` / `userMessage()` call keeps working, and adds a
 * richer `kind` that P3b uses to pick the one next step (Plan §9.6, Flow 4).
 *
 * Messages:
 * - name the provider the user chose ("This key was rejected by Groq.")
 * - never contain note text, keys or provider response bodies, so an AiError
 *   is always safe to log by `kind`.
 */
import { AppError, type ErrorCode } from '@/core';

/** Every distinct failure the engine can surface. */
export const AI_ERROR_KINDS = [
  'missing_key', // no key stored for the chosen provider
  'invalid_key', // provider answered 401/403
  'rate_limited', // provider answered 429 (or 402 quota) - see `scope`
  'offline', // no network, DNS failure, connection refused
  'timeout', // our timer fired before the provider answered
  'provider_error', // 5xx, 400, 404, unexpected body
  'too_large', // note too long for the free-tier budget, or HTTP 413
  'invalid_output', // the AI's answer failed the schema or our checks (after one re-ask)
  'cancelled', // the user pressed Cancel
  'consent_required', // first send to this provider needs the consent screen
  'age_required', // AI is an 18+ feature (Rey, Nov 1, Q1 = A)
  'blocked', // the subject has "Never send this subject to AI" turned on
  'empty_scope', // nothing editable in the chosen scope
  'stale', // undo/apply target changed since the proposal was made
  'invalid_input', // the caller passed a bad document, scope or action
  'internal', // a bug: an invariant check failed (never returns a broken doc)
] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

/** Rate limits come in two flavours with very different next steps. */
export type RateLimitScope = 'minute' | 'day';

/**
 * Nearest core ErrorCode for each kind, so code that only understands core
 * codes still behaves sensibly. `cancelled` and the consent kinds have no
 * exact core code yet; the PR proposes adding 'cancelled' and 'consent'.
 */
const CORE_CODE: Record<AiErrorKind, ErrorCode> = {
  missing_key: 'missing_key',
  invalid_key: 'invalid_key',
  rate_limited: 'rate_limited',
  offline: 'network',
  timeout: 'timeout',
  provider_error: 'provider_error',
  too_large: 'too_large',
  invalid_output: 'validation_failed',
  cancelled: 'internal',
  consent_required: 'permission_denied',
  age_required: 'permission_denied',
  blocked: 'permission_denied',
  empty_scope: 'validation_failed',
  stale: 'validation_failed',
  invalid_input: 'validation_failed',
  internal: 'internal',
};

export interface AiErrorDetails {
  /** Provider label shown in the message ("Groq"), or null when not provider-specific. */
  providerLabel?: string | null;
  /** HTTP status when the error came from a response (never the body). */
  status?: number | null;
  /** How long the provider asked us to wait, in ms, when known. */
  retryAfterMs?: number | null;
  /** Per-minute burst limit or the daily allowance. */
  scope?: RateLimitScope | null;
  /** Machine reason for invalid_output / internal (e.g. "unknown_ref"). Never content. */
  reason?: string | null;
}

export class AiError extends AppError {
  readonly kind: AiErrorKind;
  readonly providerLabel: string | null;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly scope: RateLimitScope | null;
  readonly reason: string | null;

  constructor(kind: AiErrorKind, details: AiErrorDetails = {}, message?: string) {
    super(CORE_CODE[kind], message ?? aiMessage(kind, details));
    this.name = 'AiError';
    this.kind = kind;
    this.providerLabel = details.providerLabel ?? null;
    this.status = details.status ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.scope = details.scope ?? null;
    this.reason = details.reason ?? null;
  }
}

export function isAiError(e: unknown): e is AiError {
  return e instanceof AiError;
}

/** "about 20 minutes" style wording for wait times (Plan §9.6 tone). */
export function describeWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (ms < 60_000) return 'a minute';
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? 'about an hour' : `about ${hours} hours`;
}

/**
 * Plain, friendly message for each kind. Short, specific, never blaming,
 * names the provider, implies one next step (Plan §9.6).
 */
export function aiMessage(kind: AiErrorKind, d: AiErrorDetails = {}): string {
  const p = d.providerLabel ?? 'The AI provider';
  switch (kind) {
    case 'missing_key':
      return `Add a free ${d.providerLabel ?? 'AI'} key to use AI.`;
    case 'invalid_key':
      return `This key was rejected by ${p}.`;
    case 'rate_limited':
      if (d.scope === 'day') {
        const wait = d.retryAfterMs ? describeWait(d.retryAfterMs) : 'a while';
        return `Your free ${p} limit is used up for now. Try again in ${wait}, or switch provider.`;
      }
      return `${p} is busy for a moment. Try again in a minute.`;
    case 'offline':
      return 'Needs internet. You can still use Beautify Lite.';
    case 'timeout':
      return `${p} took too long to answer. Try again.`;
    case 'provider_error':
      return `${p} is having problems. Try again later.`;
    case 'too_large':
      return 'This note is too long for one AI request. Select a part and try again.';
    case 'invalid_output':
      return "The AI's answer didn't fit, so nothing was changed. Try again.";
    case 'cancelled':
      return 'Cancelled. Nothing was changed.';
    case 'consent_required':
      return `Allow sending this note to ${p} first.`;
    case 'age_required':
      return 'AI features are for people 18 and older. Beautify Lite still works.';
    case 'blocked':
      return 'AI is turned off for this subject.';
    case 'empty_scope':
      return 'There is no text here for the AI to work on.';
    case 'stale':
      return 'The note changed since then, so this can no longer be undone here. Use version history.';
    case 'invalid_input':
      return 'This note could not be prepared for AI.';
    case 'internal':
      return 'Something went wrong, so nothing was changed.';
  }
}
