/**
 * Usage meter: AI requests and tokens per provider per local day, kept on
 * the device in one small JSON file (Rey Nov 1, Q8 = A: through core's
 * TextFilePort, so no shared SQLite schema is touched).
 *
 * Never stored: keys, note text, prompts or answers. Only counts, failure
 * kinds and the provider's "requests left today" header. A test checks this.
 *
 * Day bucketing: ALGORITHMS §8. Providers reset their own counters on their
 * own clocks (Gemini: midnight Pacific; Groq: rolling), so our daily numbers
 * are the student's local day, labelled as an approximation in P3b.
 */
import * as z from 'zod';

import type { Logger, TextFilePort } from '@/core';

import type { AiErrorKind } from '../errors';
import { PROVIDERS, type Provider } from '../keyFormat';
import { PROVIDER_CATALOG, type ModelLimits } from '../providers/catalog';

export const USAGE_FILE_VERSION = 1;
export const RETENTION_DAYS = 30;

const counterSchema = z.strictObject({
  requests: z.number().int().min(0),
  ok: z.number().int().min(0),
  failed: z.record(z.string().max(32), z.number().int().min(0)),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  /** True when any request today had no usage from the provider (estimate used). */
  estimated: z.boolean(),
  rateLimited: z.number().int().min(0),
  /** Last "requests left today" header value, if the provider sends one. */
  remainingRequests: z.number().int().min(0).nullable(),
  /** Requests per model (limits are per model on Groq). */
  byModel: z.record(z.string().max(80), z.number().int().min(0)),
  updatedAt: z.number().int().min(0),
});
export type UsageCounter = z.infer<typeof counterSchema>;

const fileSchema = z.strictObject({
  v: z.literal(USAGE_FILE_VERSION),
  days: z.record(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.partialRecord(z.enum(PROVIDERS), counterSchema),
  ),
});
type UsageFile = z.infer<typeof fileSchema>;

export interface UsageEvent {
  provider: Provider;
  model: string;
  ok: boolean;
  failure?: AiErrorKind;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  remainingRequests?: number | null;
}

export interface UsageToday extends UsageCounter {
  day: string;
  provider: Provider;
  /** Published free limits per model (null when unpublished), with their check date. */
  limits: Record<string, ModelLimits>;
  limitsCheckedOn: string;
  limitsNote: string;
}

export interface UsageMeter {
  record(e: UsageEvent): Promise<void>;
  today(provider: Provider): Promise<UsageToday>;
  /** Up to RETENTION_DAYS days, newest first. */
  history(provider: Provider): Promise<{ day: string; counter: UsageCounter }[]>;
  clear(): Promise<void>;
  /**
   * Drops the in-memory copy so the next call reads the file again (P3b:
   * "Delete all data" removes the ai folder; without this the old counts
   * would stay cached until the app restarts).
   */
  reload(): void;
}

/** §8 Local calendar day "YYYY-MM-DD" for a timestamp. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const emptyCounter = (now: number): UsageCounter => ({
  requests: 0,
  ok: 0,
  failed: {},
  inputTokens: 0,
  outputTokens: 0,
  estimated: false,
  rateLimited: 0,
  remainingRequests: null,
  byModel: {},
  updatedAt: now,
});

export function createUsageMeter(deps: { file: TextFilePort; logger: Logger; now?: () => number }): UsageMeter {
  const now = deps.now ?? Date.now;
  const log = deps.logger.child('usage');
  let cache: UsageFile | null = null;
  // Writes are serialised so two quick requests can't lose a count.
  let queue: Promise<unknown> = Promise.resolve();

  const load = async (): Promise<UsageFile> => {
    if (cache) return cache;
    let parsed: UsageFile = { v: USAGE_FILE_VERSION, days: {} };
    try {
      const raw = await deps.file.read();
      if (raw !== null && raw.length < 512_000) {
        const r = fileSchema.safeParse(JSON.parse(raw));
        if (r.success) parsed = r.data;
        else log.warn('usage_file_reset', { reason: 'schema' });
      }
    } catch {
      log.warn('usage_file_reset', { reason: 'unreadable' });
    }
    cache = parsed;
    return parsed;
  };

  /** §8 Keep only the last RETENTION_DAYS calendar days. */
  const prune = (f: UsageFile) => {
    const keep = new Set<string>();
    for (let i = 0; i < RETENTION_DAYS; i++) keep.add(localDay(now() - i * 86_400_000));
    for (const day of Object.keys(f.days)) if (!keep.has(day)) delete f.days[day];
  };

  const save = async (f: UsageFile) => {
    try {
      await deps.file.write(JSON.stringify(f));
    } catch {
      log.warn('usage_file_write_failed');
    }
  };

  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    record: (e) =>
      serial(async () => {
        const f = await load();
        const day = localDay(now());
        const bucket = (f.days[day] ??= {});
        const c = (bucket[e.provider] ??= emptyCounter(now()));
        c.requests += 1;
        if (e.ok) c.ok += 1;
        else if (e.failure) c.failed[e.failure] = (c.failed[e.failure] ?? 0) + 1;
        if (e.failure === 'rate_limited') c.rateLimited += 1;
        c.inputTokens += Math.max(0, Math.round(e.inputTokens));
        c.outputTokens += Math.max(0, Math.round(e.outputTokens));
        c.estimated = c.estimated || e.estimated;
        if (e.remainingRequests !== undefined && e.remainingRequests !== null) c.remainingRequests = e.remainingRequests;
        const model = e.model.slice(0, 80);
        c.byModel[model] = (c.byModel[model] ?? 0) + 1;
        c.updatedAt = now();
        prune(f);
        await save(f);
      }),

    today: (provider) =>
      serial(async () => {
        const f = await load();
        const day = localDay(now());
        const c = f.days[day]?.[provider] ?? emptyCounter(now());
        const info = PROVIDER_CATALOG[provider];
        return {
          ...c,
          day,
          provider,
          limits: info.freeTier.limits,
          limitsCheckedOn: info.freeTier.checkedOn,
          limitsNote: info.freeTier.note,
        };
      }),

    history: (provider) =>
      serial(async () => {
        const f = await load();
        return Object.keys(f.days)
          .sort()
          .reverse()
          .flatMap((day) => {
            const c = f.days[day]?.[provider];
            return c ? [{ day, counter: c }] : [];
          });
      }),

    clear: () =>
      serial(async () => {
        cache = { v: USAGE_FILE_VERSION, days: {} };
        await save(cache);
      }),

    reload: () => {
      cache = null;
    },
  };
}
