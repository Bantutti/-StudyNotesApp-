/**
 * Structured, redacting logger.
 *
 * Usage: logger.info('export.pdf_done', { ms: 412, pages: 2 })
 * - Event names are short identifiers, never free text.
 * - Fields pass through redactFields(); objects and Errors are not accepted.
 * - The default sink prints only in development builds.
 */
import { redactFields, type LogFields } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  scope: string;
  event: string;
  fields: Record<string, unknown>;
  at: number;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(scope: string): Logger;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const EVENT_NAME = /^[a-z0-9_.:-]{1,64}$/;

export interface LoggerOptions {
  sink: LogSink;
  minLevel?: LogLevel;
  scope?: string;
  now?: () => number;
}

export function createLogger(opts: LoggerOptions): Logger {
  const min = ORDER[opts.minLevel ?? 'info'];
  const scope = opts.scope ?? 'app';
  const now = opts.now ?? Date.now;

  const emit = (level: LogLevel, event: string, fields?: LogFields) => {
    if (ORDER[level] < min) return;
    opts.sink({
      level,
      scope,
      event: EVENT_NAME.test(event) ? event : 'invalid_event_name',
      fields: redactFields(fields),
      at: now(),
    });
  };

  return {
    debug: (e, f) => emit('debug', e, f),
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
    child: (child) => createLogger({ ...opts, scope: `${scope}.${child}` }),
  };
}

/** Development console sink. Release builds get a no-op sink. */
export function consoleSink(isDev: boolean): LogSink {
  if (!isDev) return () => undefined;
  return (r) => {
    // eslint-disable-next-line no-console -- the one sanctioned console call; input is already redacted
    console.log(`[${r.level}] ${r.scope} ${r.event}`, r.fields);
  };
}

/** Collects records in memory (tests, and the on-device diagnostics view). */
export function memorySink(limit = 200): LogSink & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink = ((r: LogRecord) => {
    records.push(r);
    if (records.length > limit) records.shift();
  }) as LogSink & { records: LogRecord[] };
  sink.records = records;
  return sink;
}
