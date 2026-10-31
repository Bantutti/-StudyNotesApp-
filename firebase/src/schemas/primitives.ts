/**
 * primitives.ts — small zod builders used by every cloud-document schema.
 *
 * Each builder attaches a `meta` record ({ kind, min, max, … }). The schemas
 * themselves don't need it; it exists so the agreement test can generate
 * boundary mutations (too long, wrong type, bad enum …) for EVERY field
 * automatically, instead of someone hand-writing them and forgetting one.
 *
 * These schemas describe a document AS READ from Firestore (timestamps are
 * Timestamp objects). Writes use serverTimestamp() for created/updated; see
 * docs/backend/DATA_MODEL.md §D.3.
 */
import { z } from 'zod';

/**
 * UTF-8 byte length without Buffer or TextEncoder, so it also runs on Hermes
 * (React Native) where Buffer does not exist. See docs/backend/LIMITS.md §L.6.1.
 * - code point < 0x80     -> 1 byte
 * - code point < 0x800    -> 2 bytes
 * - code point < 0x10000  -> 3 bytes (BMP, includes lone surrogates, which
 *                            Firestore would reject anyway)
 * - otherwise             -> 4 bytes (astral, e.g. emoji: two UTF-16 units)
 */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    // for..of walks code points, so a surrogate pair arrives as one `ch`.
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * A string bounded in UTF-16 code units (JavaScript `.length`).
 *
 * WHY NOT z.string().max(): zod 4.6.x measures length in Unicode CODE POINTS
 * (an emoji counts 1), but Firestore rules' string.size() counts UTF-16 UNITS
 * (an emoji counts 2) — verified in tests/rules/limits-probe.test.ts. Using
 * zod's .max() would let the app accept a 41-emoji subject name (82 units)
 * that the rules then reject at sync time. Measuring `.length` keeps zod and
 * the rules identical. See docs/backend/LIMITS.md §L.4.
 */
export function utf16String(min: number, max: number) {
  return z
    .string()
    .refine((s) => s.length >= min, { message: `Must be at least ${min} UTF-16 units` })
    .refine((s) => s.length <= max, { message: `Must be at most ${max} UTF-16 units` });
}

/** Describes one field for the mutation generator. */
export type FieldMeta =
  | { kind: 'string'; min: number; max: number; pattern?: RegExp }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'bool' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'literal'; value: number | string }
  | { kind: 'timestamp'; role: 'client' | 'server' }
  | { kind: 'stringList'; maxItems: number; itemMin: number; itemMax: number }
  | { kind: 'intList'; maxItems: number; itemMin: number; itemMax: number; rulesCheckItems: false }
  | { kind: 'timestampList'; maxItems: number }
  | { kind: 'json'; min: number; max: number };

/** Typed wrapper so callers can't attach a malformed meta object. */
function withMeta<T extends z.ZodType>(schema: T, meta: FieldMeta): T {
  return schema.meta({ field: meta });
}

/** Reads the FieldMeta back (unwrapping .nullable()). Returns undefined for unknown schemas. */
export function fieldMetaOf(schema: z.ZodType): { meta: FieldMeta; nullable: boolean } | undefined {
  let nullable = false;
  let s: z.ZodType = schema;
  // .nullable() wraps the schema; the meta lives on the inner one.
  if (s instanceof z.ZodNullable) {
    nullable = true;
    s = s.unwrap() as z.ZodType;
  }
  const m = s.meta() as { field?: FieldMeta } | undefined;
  return m?.field ? { meta: m.field, nullable } : undefined;
}

/** Bounded string, optionally with a full-match regex. */
export function str(min: number, max: number, pattern?: RegExp) {
  let s = utf16String(min, max);
  if (pattern) s = s.regex(pattern);
  return withMeta(s, pattern ? { kind: 'string', min, max, pattern } : { kind: 'string', min, max });
}

/** Bounded integer (rejects 1.5, NaN, Infinity). */
export function int(min: number, max: number) {
  return withMeta(z.int().min(min).max(max), { kind: 'int', min, max });
}

export function bool() {
  return withMeta(z.boolean(), { kind: 'bool' });
}

export function enumOf<const T extends readonly [string, ...string[]]>(values: T) {
  return withMeta(z.enum(values), { kind: 'enum', values });
}

export function literal<const T extends number | string>(value: T) {
  return withMeta(z.literal(value), { kind: 'literal', value });
}

/**
 * Firestore Timestamp, duck-typed so the schema works with the JS SDK, the
 * Admin SDK or React Native Firebase without importing any of them.
 */
export interface TimestampLike {
  seconds: number;
  nanoseconds: number;
  toMillis(): number;
}

const timestampLike = z.custom<TimestampLike>(
  (v) =>
    v !== null &&
    typeof v === 'object' &&
    Number.isInteger((v as TimestampLike).seconds) &&
    Number.isInteger((v as TimestampLike).nanoseconds) &&
    (v as TimestampLike).nanoseconds >= 0 &&
    (v as TimestampLike).nanoseconds <= 999_999_999 &&
    typeof (v as TimestampLike).toMillis === 'function',
  { message: 'Expected a Firestore Timestamp' },
);

/** role 'server' = must be serverTimestamp() on write (rules check request.time). */
export function timestamp(role: 'client' | 'server') {
  return withMeta(timestampLike, { kind: 'timestamp', role });
}

/** List of bounded strings; unique items (tags). */
export function stringList(maxItems: number, itemMin: number, itemMax: number) {
  const s = z
    .array(utf16String(itemMin, itemMax))
    .max(maxItems)
    .refine((a) => new Set(a).size === a.length, { message: 'Items must be unique' });
  return withMeta(s, { kind: 'stringList', maxItems, itemMin, itemMax });
}

/** List of bounded ints. Rules can only check the list size (documented gap). */
export function intList(maxItems: number, itemMin: number, itemMax: number) {
  return withMeta(z.array(z.int().min(itemMin).max(itemMax)).max(maxItems), {
    kind: 'intList',
    maxItems,
    itemMin,
    itemMax,
    rulesCheckItems: false,
  });
}

export function timestampList(maxItems: number) {
  return withMeta(z.array(timestampLike).max(maxItems), { kind: 'timestampList', maxItems });
}

/**
 * A JSON document stored as a capped string (decision 3).
 * - Outer cap (characters) is enforced by BOTH zod and the rules.
 * - Parsing and the inner schema are zod-only: rules cannot parse JSON.
 * - Optional UTF-8 byte cap (zod-only) protects Firestore's 1 MiB doc limit.
 */
export function jsonString(min: number, max: number, inner: z.ZodType, maxBytes?: number) {
  const s = utf16String(min, max)
    .superRefine((raw, ctx) => {
      // Byte cap first: cheap, and it avoids parsing something we'd reject anyway.
      if (maxBytes !== undefined && utf8ByteLength(raw) > maxBytes) {
        ctx.addIssue({ code: 'custom', message: `JSON exceeds ${maxBytes} UTF-8 bytes` });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Not valid JSON' });
        return;
      }
      const r = inner.safeParse(parsed);
      if (!r.success) {
        for (const issue of r.error.issues) {
          ctx.addIssue({ code: 'custom', message: `inner: ${issue.message}`, path: issue.path });
        }
      }
    });
  return withMeta(s, { kind: 'json', min, max });
}
