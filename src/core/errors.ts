/**
 * Typed application errors.
 *
 * Errors carry a stable machine `code` and a short user-facing message.
 * They never carry note content, keys, or raw server responses, so they are
 * always safe to log by code.
 */
export type ErrorCode =
  | 'validation_failed'
  | 'too_large'
  | 'not_found'
  | 'permission_denied'
  | 'invalid_key'
  | 'missing_key'
  | 'rate_limited'
  | 'network'
  | 'timeout'
  | 'provider_error'
  | 'unsupported'
  /** The user cancelled (e.g. an AI request). Not a failure: show no error. */
  | 'cancelled'
  /** A consent screen must be accepted first (e.g. first send to an AI provider). */
  | 'consent'
  | 'internal';

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, userMessage: string) {
    super(userMessage);
    this.name = 'AppError';
    this.code = code;
  }
}

/** Returns a log-safe code for any thrown value (never its message). */
export function errorCode(err: unknown): ErrorCode | 'unknown' {
  if (err instanceof AppError) return err.code;
  return 'unknown';
}

/** Returns a message safe to show users. Unknown errors get a generic text. */
export function userMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  return 'Something went wrong. Please try again.';
}
