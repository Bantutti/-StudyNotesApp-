/**
 * Token pacer: keeps a long, chunked AI action under a model's
 * tokens-per-minute (TPM) limit instead of hitting 429 on chunk 2.
 *
 * Maths: ALGORITHMS.md §2 (sliding 60-second window).
 * Groq's free gpt-oss limit is 8,000 TPM, so two ~6K-token chunks in a row
 * would otherwise fail. Providers with no published TPM are not paced.
 */
import type { Sleep } from './retry';

export const WINDOW_MS = 60_000;
/** Never wait longer than this; past it we send and let the provider decide. */
export const MAX_PACE_WAIT_MS = 60_000;

interface Entry {
  at: number; // ms timestamp when the tokens were spent
  tokens: number;
}

export interface TokenPacer {
  /**
   * §2.2 How long to wait (ms) before spending `tokens` so the 60 s window
   * stays at or under the limit. 0 when it fits now.
   */
  waitNeeded(tokens: number): number;
  /** Waits (abortable) if needed, then reserves the tokens. Returns ms waited. */
  acquire(tokens: number, signal?: AbortSignal): Promise<number>;
  /** §2.3 Replaces the reserved estimate with the real count once known. */
  settle(reserved: number, actual: number): void;
}

export function createTokenPacer(limitTpm: number, now: () => number, sleep: Sleep): TokenPacer {
  const entries: Entry[] = [];

  /** Drops entries that left the window. */
  const prune = (t: number) => {
    while (entries.length > 0 && (entries[0] as Entry).at <= t - WINDOW_MS) entries.shift();
  };

  const waitNeeded = (tokens: number): number => {
    const t = now();
    prune(t);
    // A single request bigger than the whole limit can never fit: don't wait.
    if (tokens >= limitTpm) return 0;
    let used = entries.reduce((s, e) => s + e.tokens, 0);
    if (used + tokens <= limitTpm) return 0;
    // §2.2 Walk forward through the oldest entries until enough expire.
    for (const e of entries) {
      used -= e.tokens;
      if (used + tokens <= limitTpm) return Math.max(0, e.at + WINDOW_MS - t);
    }
    return 0;
  };

  return {
    waitNeeded,
    async acquire(tokens, signal) {
      const wait = waitNeeded(tokens);
      const waited = wait > 0 && wait <= MAX_PACE_WAIT_MS ? wait : 0;
      if (waited > 0) await sleep(waited, signal);
      entries.push({ at: now(), tokens });
      return waited;
    },
    settle(reserved, actual) {
      // Find the most recent reservation with this size and correct it.
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as Entry;
        if (e.tokens === reserved) {
          e.tokens = Math.max(0, actual);
          return;
        }
      }
    },
  };
}
