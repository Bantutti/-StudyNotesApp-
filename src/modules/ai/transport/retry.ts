/**
 * Retry policy, backoff and rate-limit header parsing.
 *
 * Maths and rules: ALGORITHMS.md §3. Decisions: Rey Nov 1, Q9 = A (auto-retry
 * a 429 only when Retry-After is 10 s or less, and only once).
 *
 * Everything here is pure or takes its clock/sleep/random source as a
 * parameter, so tests are deterministic.
 */
import { AiError } from '../errors';

/** Q9: the longest Retry-After we wait out automatically. */
export const AUTO_RETRY_MAX_WAIT_MS = 10_000;
/** §3.1: first backoff step and the cap. */
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 8_000;
/** §3.4: retry budgets per failure type. */
export const MAX_SERVER_RETRIES = 2;
export const MAX_TIMEOUT_RETRIES = 1;
/** §3.3: a wait longer than this means the daily allowance, not a burst. */
export const DAY_SCOPE_THRESHOLD_MS = 60_000;

/**
 * §3.1 "equal jitter" backoff:
 *   d(n) = min(cap, base · 2^n) · (0.5 + 0.5 · r),  r ∈ [0, 1)
 * n is the 0-based retry number. Half the delay is fixed (so we always back
 * off), half is random (so many phones don't retry in lockstep).
 */
export function backoffDelay(n: number, random: () => number, base = BACKOFF_BASE_MS, cap = BACKOFF_CAP_MS): number {
  const exp = Math.min(cap, base * 2 ** Math.max(0, n));
  const r = Math.min(Math.max(random(), 0), 0.999_999); // clamp a misbehaving source
  return Math.round(exp * (0.5 + 0.5 * r));
}

/**
 * §3.2 Retry-After header: either delta-seconds ("2") or an HTTP date.
 * Returns milliseconds from `nowMs`, or null when absent or unparseable.
 * Negative dates (already past) become 0.
 */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const v = value.trim();
  if (v === '') return null;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const seconds = Number(v);
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
  }
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/**
 * §3.2 Groq's x-ratelimit-reset-* headers use Go-style durations such as
 * "2m59.56s", "7.66s", "1h0m0s" or "450ms". Returns milliseconds or null.
 * The whole string must be made of number+unit pairs; anything else is null.
 */
export function parseDuration(value: string | null): number | null {
  if (value === null) return null;
  const v = value.trim();
  if (v === '' || !/^(\d+(\.\d+)?(h|ms|m|s))+$/.test(v)) return null;
  const UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };
  let total = 0;
  // "ms" must be tried before "m" so "450ms" is not read as 450 minutes + "s".
  for (const match of v.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    const amount = Number(match[1]);
    const unit = match[2] as string;
    total += amount * (UNIT_MS[unit] ?? 0);
  }
  return Math.round(total);
}

/** Non-negative integer header (x-ratelimit-remaining-*), or null. */
export function parseCount(value: string | null): number | null {
  if (value === null) return null;
  const v = value.trim();
  if (!/^\d{1,12}$/.test(v)) return null;
  return Number(v);
}

/**
 * §3.3 Decide whether a 429 is a short burst limit or the daily allowance.
 * - remaining requests for the day = 0      -> day
 * - asked to wait longer than a minute      -> day
 * - otherwise                               -> minute
 */
export function rateLimitScope(retryAfterMs: number | null, remainingRequests: number | null): 'minute' | 'day' {
  if (remainingRequests === 0) return 'day';
  if (retryAfterMs !== null && retryAfterMs > DAY_SCOPE_THRESHOLD_MS) return 'day';
  return 'minute';
}

/** Sleep that rejects with AiError('cancelled') when the signal aborts. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const realSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiError('cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiError('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export interface RetryOptions {
  sleep: Sleep;
  random: () => number;
  signal?: AbortSignal;
  /** Called before each wait so the UI can say "retrying in 2 s". */
  onRetry?: (info: { reason: 'rate_limited' | 'server' | 'timeout'; waitMs: number; attempt: number }) => void;
}

/**
 * §3.4 Runs `call` and retries only the failures that are worth retrying:
 * - rate_limited: once, only if Retry-After is known and <= 10 s (Q9)
 * - provider_error with HTTP 5xx: up to 2 times with equal-jitter backoff
 * - timeout: once, with backoff
 * Everything else (bad key, offline, 4xx, cancelled) is thrown at once.
 */
export async function withRetry<T>(call: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let serverRetries = 0;
  let timeoutRetries = 0;
  let rateRetried = false;
  let attempt = 0;
  for (;;) {
    try {
      return await call();
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      if (opts.signal?.aborted) throw new AiError('cancelled');
      let waitMs: number | null = null;
      let reason: 'rate_limited' | 'server' | 'timeout' = 'server';

      if (e.kind === 'rate_limited' && !rateRetried && e.retryAfterMs !== null && e.retryAfterMs <= AUTO_RETRY_MAX_WAIT_MS) {
        rateRetried = true;
        reason = 'rate_limited';
        waitMs = e.retryAfterMs + 250; // small margin so the window has really reset
      } else if (e.kind === 'provider_error' && e.status !== null && e.status >= 500 && serverRetries < MAX_SERVER_RETRIES) {
        reason = 'server';
        waitMs = backoffDelay(serverRetries, opts.random);
        serverRetries++;
      } else if (e.kind === 'timeout' && timeoutRetries < MAX_TIMEOUT_RETRIES) {
        reason = 'timeout';
        waitMs = backoffDelay(timeoutRetries, opts.random);
        timeoutRetries++;
      }

      if (waitMs === null) throw e;
      attempt++;
      opts.onRetry?.({ reason, waitMs, attempt });
      await opts.sleep(waitMs, opts.signal);
    }
  }
}
