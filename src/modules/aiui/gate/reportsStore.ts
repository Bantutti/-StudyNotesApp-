/**
 * "Report this AI result" (C1 research, Q10 = A): a LOCAL record only.
 *
 * Nothing is sent anywhere (there is no report server, and the app has no
 * analytics in v1). The record holds metadata only: which action, provider,
 * model and prompt version produced the result, when, a reason chip and an
 * optional short comment the student types. It never holds note text or the
 * AI's output. The student can read and delete reports in AI settings; they
 * help when the student reports a problem by hand (TESTING_ON_DEVICE §10).
 *
 * File: ai/reports.json, newest first, capped at MAX_REPORTS.
 */
import * as z from 'zod';

import type { IdGenerator, Logger, TextFilePort } from '@/core';
import { AI_ACTIONS, PROVIDERS } from '@/modules/ai';

export const REPORT_REASONS = ['wrong', 'harmful', 'changed_meaning', 'broke_format', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_COMMENT_MAX = 200;
export const MAX_REPORTS = 50;
const FILE_MAX_CHARS = 64_000;

const reportSchema = z.strictObject({
  id: z.string().min(1).max(64),
  at: z.number().int().min(0),
  action: z.enum(AI_ACTIONS),
  provider: z.enum(PROVIDERS),
  models: z.array(z.string().max(80)).max(4),
  promptVersion: z.string().max(80),
  reason: z.enum(REPORT_REASONS),
  // UTF-16 length check (s.length), like P2a's utf16String, so the cap is what the screen shows.
  comment: z.string().refine((s) => s.length <= REPORT_COMMENT_MAX),
});
export type AiReport = z.infer<typeof reportSchema>;
const fileSchema = z.strictObject({ v: z.literal(1), reports: z.array(reportSchema).max(MAX_REPORTS) });

export type NewReport = Omit<AiReport, 'id' | 'at'>;

export interface ReportsStore {
  add(r: NewReport): Promise<AiReport>;
  list(): Promise<AiReport[]>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /** Delete all data: drop the in-memory copy (the file goes with the ai folder). */
  forget(): void;
}

export function createReportsStore(deps: { file: TextFilePort; ids: IdGenerator; logger: Logger; now?: () => number }): ReportsStore {
  const now = deps.now ?? Date.now;
  const log = deps.logger.child('ai_reports');
  let cache: AiReport[] | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const load = async (): Promise<AiReport[]> => {
    if (cache) return cache;
    let list: AiReport[] = [];
    try {
      const raw = await deps.file.read();
      if (raw !== null && raw.length <= FILE_MAX_CHARS) {
        const r = fileSchema.safeParse(JSON.parse(raw));
        if (r.success) list = r.data.reports;
        else log.warn('reports_file_reset', { reason: 'schema' });
      }
    } catch {
      log.warn('reports_file_reset', { reason: 'unreadable' });
    }
    cache = list;
    return list;
  };

  const save = async (list: AiReport[]) => {
    await deps.file.write(JSON.stringify({ v: 1, reports: list }));
    cache = list;
  };

  return {
    add: (input) =>
      serial(async () => {
        // Validate the whole record: a too-long comment or unknown reason is rejected, not trimmed silently.
        const report = reportSchema.parse({ ...input, comment: input.comment.trim(), id: deps.ids.newId('rep'), at: now() });
        await save([report, ...(await load())].slice(0, MAX_REPORTS));
        log.info('report_saved', { reason: report.reason, action: report.action }); // no comment, no text
        return report;
      }),
    list: () => serial(async () => [...(await load())]),
    remove: (id) => serial(async () => save((await load()).filter((r) => r.id !== id))),
    clear: () => serial(async () => save([])),
    forget: () => {
      cache = null;
    },
  };
}
