import type { z } from 'zod';

import { AppError } from './errors';

/** Discriminated result type for operations that can fail without throwing. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(error: AppError): Result<T> => ({ ok: false, error });

/**
 * Validates untrusted data at a module boundary.
 * Issue details stay out of the error message on purpose: they can echo
 * the rejected input, which may be note content.
 */
export function parseWith<S extends z.ZodType>(
  schema: S,
  data: unknown,
  what: string,
): Result<z.infer<S>> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return ok(parsed.data);
  return fail(new AppError('validation_failed', `${what} is not valid.`));
}

/** Same as parseWith but throws AppError. Use only where a throw is handled. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown, what: string): z.infer<S> {
  const r = parseWith(schema, data, what);
  if (!r.ok) throw r.error;
  return r.value;
}

/** UTF-8 byte length without TextEncoder (not guaranteed on every runtime). */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i++; // surrogate pair counts once
    } else bytes += 3;
  }
  return bytes;
}
