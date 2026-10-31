/**
 * Transport: retry maths (ALGORITHMS §3), the fixed-host HTTP client and the
 * token pacer (§2).
 */
import { AiError } from '../errors';
import { ALLOWED_BASES, httpJson, MAX_RESPONSE_CHARS } from '../transport/http';
import { createTokenPacer } from '../transport/pacer';
import {
  backoffDelay,
  parseCount,
  parseDuration,
  parseRetryAfter,
  rateLimitScope,
  withRetry,
} from '../transport/retry';
import { GROQ_KEY, jsonResponse } from './fixtures';

const noSleep = async () => undefined;

describe('§3.1 backoff', () => {
  it('doubles from 1 s, caps at 8 s, and keeps half the delay fixed', () => {
    expect(backoffDelay(0, () => 0)).toBe(500); // 1000 * 0.5
    expect(backoffDelay(0, () => 0.999_999)).toBe(1000);
    expect(backoffDelay(1, () => 0)).toBe(1000); // 2000 * 0.5
    expect(backoffDelay(10, () => 0.999_999)).toBe(8000); // capped
    expect(backoffDelay(2, () => 5)).toBe(4000); // bad random source is clamped
  });
});

describe('§3.2 header parsing', () => {
  it('reads Retry-After as seconds or an HTTP date', () => {
    expect(parseRetryAfter('2', 0)).toBe(2000);
    expect(parseRetryAfter('1.5', 0)).toBe(1500);
    const now = Date.parse('2026-11-01T00:00:00Z');
    expect(parseRetryAfter('Sun, 01 Nov 2026 00:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Sat, 31 Oct 2026 00:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
  });
  it("reads Groq's Go-style durations", () => {
    expect(parseDuration('2m59.56s')).toBe(179_560);
    expect(parseDuration('7.66s')).toBe(7_660);
    expect(parseDuration('1h0m0s')).toBe(3_600_000);
    expect(parseDuration('450ms')).toBe(450);
    expect(parseDuration('12')).toBeNull();
    expect(parseDuration('2 minutes')).toBeNull();
  });
  it('reads counts and decides minute vs day scope', () => {
    expect(parseCount('14370')).toBe(14370);
    expect(parseCount('-1')).toBeNull();
    expect(rateLimitScope(2_000, 500)).toBe('minute');
    expect(rateLimitScope(null, 0)).toBe('day');
    expect(rateLimitScope(20 * 60_000, null)).toBe('day');
    expect(rateLimitScope(null, null)).toBe('minute');
  });
});

describe('§3.4 withRetry', () => {
  const rl = (ms: number | null) => new AiError('rate_limited', { retryAfterMs: ms, scope: 'minute', providerLabel: 'Groq' });

  it('retries a 429 once when Retry-After <= 10 s (Q9)', async () => {
    const waits: number[] = [];
    let n = 0;
    const r = await withRetry(
      async () => {
        if (n++ === 0) throw rl(3_000);
        return 'ok';
      },
      { sleep: async (ms) => void waits.push(ms), random: () => 0 },
    );
    expect(r).toBe('ok');
    expect(waits).toEqual([3_250]);
  });

  it('does not retry a 429 with a long or unknown wait, or a second 429', async () => {
    await expect(withRetry(async () => Promise.reject(rl(11_000)), { sleep: noSleep, random: () => 0 })).rejects.toMatchObject({ kind: 'rate_limited' });
    await expect(withRetry(async () => Promise.reject(rl(null)), { sleep: noSleep, random: () => 0 })).rejects.toMatchObject({ kind: 'rate_limited' });
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw rl(1_000);
        },
        { sleep: noSleep, random: () => 0 },
      ),
    ).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(calls).toBe(2);
  });

  it('retries 5xx twice with backoff, timeouts once, and never 401/offline', async () => {
    let calls = 0;
    const waits: number[] = [];
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new AiError('provider_error', { status: 503 });
        },
        { sleep: async (ms) => void waits.push(ms), random: () => 0 },
      ),
    ).rejects.toMatchObject({ kind: 'provider_error' });
    expect(calls).toBe(3);
    expect(waits).toEqual([500, 1000]);

    calls = 0;
    await expect(withRetry(async () => { calls++; throw new AiError('timeout'); }, { sleep: noSleep, random: () => 0 })).rejects.toMatchObject({ kind: 'timeout' });
    expect(calls).toBe(2);

    for (const kind of ['invalid_key', 'offline', 'too_large'] as const) {
      calls = 0;
      await expect(withRetry(async () => { calls++; throw new AiError(kind); }, { sleep: noSleep, random: () => 0 })).rejects.toMatchObject({ kind });
      expect(calls).toBe(1);
    }
    calls = 0;
    await expect(withRetry(async () => { calls++; throw new AiError('provider_error', { status: 400 }); }, { sleep: noSleep, random: () => 0 })).rejects.toMatchObject({ kind: 'provider_error' });
    expect(calls).toBe(1);
  });

  it('stops with cancelled when the signal aborts during a wait', async () => {
    const ctrl = new AbortController();
    await expect(
      withRetry(
        async () => {
          throw new AiError('provider_error', { status: 500 });
        },
        {
          sleep: async () => {
            ctrl.abort();
            throw new AiError('cancelled');
          },
          random: () => 0,
          signal: ctrl.signal,
        },
      ),
    ).rejects.toMatchObject({ kind: 'cancelled' });
  });
});

describe('httpJson (fixed hosts, key in header only, bodies of errors never read)', () => {
  const base = { method: 'POST' as const, apiKey: GROQ_KEY, timeoutMs: 5_000, providerLabel: 'Groq', now: () => 0 };

  it('allows only the catalog hosts', async () => {
    expect(ALLOWED_BASES).toEqual(['https://api.groq.com/openai/v1/', 'https://api.mistral.ai/v1/']);
    const fetchFn = jest.fn();
    await expect(httpJson({ ...base, fetchFn, url: 'https://evil.example/v1/chat' })).rejects.toMatchObject({ kind: 'internal', reason: 'host_not_allowed' });
    await expect(httpJson({ ...base, fetchFn, url: 'https://api.groq.com.evil.example/x' })).rejects.toMatchObject({ kind: 'internal' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends the key only in the Authorization header', async () => {
    const fetchFn = jest.fn(async () => jsonResponse(200, { ok: true }));
    await httpJson({ ...base, fetchFn, url: 'https://api.groq.com/openai/v1/chat/completions', body: { a: 1 } });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(GROQ_KEY);
    expect(String(init.body)).not.toContain(GROQ_KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${GROQ_KEY}`);
  });

  it('maps statuses without reading error bodies', async () => {
    const cases: [number, Record<string, string>, object][] = [
      [401, {}, { kind: 'invalid_key', status: 401 }],
      [403, {}, { kind: 'invalid_key' }],
      [429, { 'retry-after': '2' }, { kind: 'rate_limited', retryAfterMs: 2000, scope: 'minute' }],
      [429, { 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '25m0s' }, { kind: 'rate_limited', retryAfterMs: 1_500_000, scope: 'day' }],
      [402, {}, { kind: 'rate_limited', scope: 'day' }],
      [413, {}, { kind: 'too_large' }],
      [404, {}, { kind: 'provider_error', reason: 'model_or_endpoint_not_found' }],
      [503, {}, { kind: 'provider_error', status: 503 }],
    ];
    for (const [status, headers, expected] of cases) {
      const res = jsonResponse(status, { error: { message: 'echo of the secret note' } }, headers);
      const fetchFn = jest.fn(async () => res);
      const err = await httpJson({ ...base, fetchFn, url: 'https://api.groq.com/openai/v1/x' }).catch((e: unknown) => e);
      expect(err).toMatchObject(expected);
      expect((err as Error).message).not.toContain('secret note');
      expect((res as unknown as { bodyUsed: boolean }).bodyUsed).toBe(false);
    }
  });

  it('reports offline, timeout and cancel as different kinds', async () => {
    const url = 'https://api.groq.com/openai/v1/x';
    await expect(httpJson({ ...base, url, fetchFn: async () => Promise.reject(new TypeError('Network request failed')) })).rejects.toMatchObject({ kind: 'offline' });

    const hang: typeof fetch = (_u, init) =>
      new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    await expect(httpJson({ ...base, url, fetchFn: hang, timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout' });

    const ctrl = new AbortController();
    const p = httpJson({ ...base, url, fetchFn: hang, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('rejects oversized and non-JSON success bodies', async () => {
    const url = 'https://api.groq.com/openai/v1/x';
    await expect(httpJson({ ...base, url, fetchFn: async () => jsonResponse(200, 'x'.repeat(MAX_RESPONSE_CHARS + 1)) })).rejects.toMatchObject({ reason: 'response_too_large' });
    await expect(httpJson({ ...base, url, fetchFn: async () => jsonResponse(200, '<html>') })).rejects.toMatchObject({ reason: 'response_not_json' });
  });
});

describe('§2 token pacer', () => {
  it('waits until enough of the 60 s window has expired', async () => {
    let t = 0;
    const slept: number[] = [];
    const pacer = createTokenPacer(8_000, () => t, async (ms) => {
      slept.push(ms);
      t += ms;
    });
    expect(await pacer.acquire(5_000)).toBe(0); // t=0, window: 5000
    t = 10_000;
    expect(pacer.waitNeeded(2_000)).toBe(0); // 7000 <= 8000
    expect(pacer.waitNeeded(4_000)).toBe(50_000); // needs the t=0 entry to expire at 60 s
    expect(await pacer.acquire(4_000)).toBe(50_000);
    expect(slept).toEqual([50_000]);
  });

  it('settles estimates to real counts and never waits for an impossible request', async () => {
    let t = 0;
    const pacer = createTokenPacer(8_000, () => t, async () => undefined);
    await pacer.acquire(6_000);
    pacer.settle(6_000, 1_000);
    expect(pacer.waitNeeded(6_000)).toBe(0); // 1000 + 6000 <= 8000
    expect(pacer.waitNeeded(9_000)).toBe(0); // bigger than the limit: send and let the provider decide
  });
});
