import { AppError } from '../errors';
import { fail, ok, utf8Length, type Result } from '../validation';
import { checkDocLimits, checkDocStructure, DOC_LIMITS, noteDocSchema, type NoteDoc } from './schema';

/**
 * Parses an untrusted serialized document (string) into a validated NoteDoc.
 * Order matters: size check before JSON.parse, schema before limits.
 */
export function parseNoteDocJson(json: string): Result<NoteDoc> {
  if (utf8Length(json) > DOC_LIMITS.maxJsonBytes) {
    return fail(new AppError('too_large', 'This note is too large.'));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fail(new AppError('validation_failed', 'The note data is not valid.'));
  }
  return validateNoteDoc(raw);
}

/** Validates an already-parsed value (e.g. from a typed bridge message). */
export function validateNoteDoc(raw: unknown): Result<NoteDoc> {
  const parsed = noteDocSchema.safeParse(raw);
  if (!parsed.success) return fail(new AppError('validation_failed', 'The note data is not valid.'));
  const limits = checkDocLimits(parsed.data);
  if (!limits.ok) return fail(new AppError('too_large', 'This note is too large or too deeply nested.'));
  if (checkDocStructure(parsed.data) !== null) return fail(new AppError('validation_failed', 'The note data is not valid.'));
  return ok(parsed.data);
}
