/**
 * Fixed-host HTTPS JSON transport for AI providers.
 *
 * Security rules enforced here (Plan §14, §17; build rules §1):
 * - Only URLs that start with an allow-listed provider base are ever fetched.
 *   Bases are constants in the catalog; nothing user-controlled builds a URL.
 * - The key travels only in the Authorization header, never in the URL.
 * - Error bodies are NEVER read: they can echo the note back. Only the HTTP
 *   status and the rate-limit headers are used.
 * - Success bodies are size-capped BEFORE JSON.parse.
 * - Timeouts and user cancellation both abort the request; they are reported
 *   as different kinds ('timeout' vs 'cancelled').
 */
import { AiError } from '../errors';
import { PROVIDER_CATALOG } from '../providers/catalog';
import { parseCount, parseDuration, parseRetryAfter, rateLimitScope } from './retry';

/** Largest response body we will parse (1 M UTF-16 units ≈ 2 MB). */
export const MAX_RESPONSE_CHARS = 1_000_000;

/** The only URL prefixes the transport will call. */
export const ALLOWED_BASES: readonly string[] = Object.values(PROVIDER_CATALOG).map((p) => `${p.apiBase}/`);

/** Rate-limit facts read from response headers (all optional). */
export interface RateInfo {
  /** Requests left today (Groq: x-ratelimit-remaining-requests is per day). */
  remainingRequests: number | null;
  /** Time until the daily request counter resets, ms. */
  resetRequestsMs: number | null;
  /** Tokens left this minute (Groq: x-ratelimit-remaining-tokens is per minute). */
  remainingTokens: number | null;
}

export interface HttpRequest {
  fetchFn: typeof fetch;
  url: string;
  method: 'GET' | 'POST';
  apiKey: string;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  providerLabel: string;
  now: () => number;
}

export interface HttpResponse {
  status: number;
  json: unknown;
  rate: RateInfo;
}

export function assertAllowedUrl(url: string): void {
  if (!ALLOWED_BASES.some((base) => url.startsWith(base))) {
    // A bug, not a user error: an un-listed host must never receive the key.
    throw new AiError('internal', { reason: 'host_not_allowed' });
  }
}

/** Header reader that tolerates fetch mocks without a Headers object. */
function header(res: Response, name: string): string | null {
  try {
    return res.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}

export function readRateInfo(res: Response): RateInfo {
  return {
    remainingRequests: parseCount(header(res, 'x-ratelimit-remaining-requests')),
    resetRequestsMs: parseDuration(header(res, 'x-ratelimit-reset-requests')),
    remainingTokens: parseCount(header(res, 'x-ratelimit-remaining-tokens')),
  };
}

/**
 * Maps a non-2xx status to an AiError. The body is not read (see header).
 * 429/402 carry the wait time and the minute/day scope (ALGORITHMS §3.3).
 */
export function statusToError(res: Response, providerLabel: string, now: number): AiError {
  const status = res.status;
  const base = { providerLabel, status };
  if (status === 401 || status === 403) return new AiError('invalid_key', base);
  if (status === 429 || status === 402) {
    const rate = readRateInfo(res);
    // Prefer the explicit Retry-After. If it's missing but the daily counter
    // is at 0, the time until the counter resets is the real wait.
    const headerWait = parseRetryAfter(header(res, 'retry-after'), now);
    const retryAfterMs = headerWait ?? (rate.remainingRequests === 0 ? rate.resetRequestsMs : null);
    // 402 (payment / quota) is treated as the daily allowance being used up.
    const scope = status === 402 ? 'day' : rateLimitScope(retryAfterMs, rate.remainingRequests);
    return new AiError('rate_limited', { ...base, retryAfterMs, scope });
  }
  if (status === 408) return new AiError('timeout', base);
  if (status === 413) return new AiError('too_large', base);
  if (status === 400 || status === 404 || status === 422) {
    return new AiError('provider_error', { ...base, reason: status === 404 ? 'model_or_endpoint_not_found' : 'request_rejected' });
  }
  return new AiError('provider_error', base);
}

/**
 * Performs one HTTPS call. Throws AiError for every failure:
 * cancelled, timeout, offline (fetch rejected), HTTP status errors, and
 * 'provider_error' for an oversized or non-JSON success body.
 */
export async function httpJson(req: HttpRequest): Promise<HttpResponse> {
  assertAllowedUrl(req.url);
  if (req.signal?.aborted) throw new AiError('cancelled');

  // One controller aborts the fetch for either reason; we remember which.
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, req.timeoutMs);
  const onUserAbort = () => ctrl.abort();
  req.signal?.addEventListener('abort', onUserAbort, { once: true });

  try {
    let res: Response;
    try {
      res = await req.fetchFn(req.url, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          Accept: 'application/json',
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: ctrl.signal,
      });
    } catch {
      // fetch rejects for network failures and for aborts.
      if (req.signal?.aborted) throw new AiError('cancelled');
      if (timedOut) throw new AiError('timeout', { providerLabel: req.providerLabel });
      throw new AiError('offline', { providerLabel: req.providerLabel });
    }

    if (!res.ok) throw statusToError(res, req.providerLabel, req.now());

    let text: string;
    try {
      text = await res.text();
    } catch {
      if (req.signal?.aborted) throw new AiError('cancelled');
      if (timedOut) throw new AiError('timeout', { providerLabel: req.providerLabel });
      throw new AiError('offline', { providerLabel: req.providerLabel });
    }
    if (text.length > MAX_RESPONSE_CHARS) {
      throw new AiError('provider_error', { providerLabel: req.providerLabel, status: res.status, reason: 'response_too_large' });
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AiError('provider_error', { providerLabel: req.providerLabel, status: res.status, reason: 'response_not_json' });
    }
    return { status: res.status, json, rate: readRateInfo(res) };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onUserAbort);
  }
}
