/**
 * Cloud limits mirrored from P2a (firebase/src/schemas/limits.ts).
 *
 * Every synced field is validated locally with the SAME numbers the cloud
 * uses, so nothing the app accepts is rejected later at sync time (P2b).
 * A contract test compares these values with P2a's file once firebase/ is
 * on main (see src/core/__tests__/limits.test.ts).
 *
 * Lengths are UTF-16 code units (JS `.length`), exactly what Firestore
 * rules' string.size() counts. zod's .max() counts code points instead,
 * so synced strings must use utf16String() below (P2a MERGE_NOTES §6.2).
 */
import * as z from 'zod';

/** Cloud schema version stored on every synced row (P2a §L.1). */
export const SCHEMA_VERSION = 1 as const;

/** Entity ids: 16..64 chars of [A-Za-z0-9_-] (P2a §L.2). */
export const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** References to built-in packs/templates may be short ("clear-read") (P2a §L.2). */
export const REF_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Subject colour: 6 hex digits WITHOUT '#', as stored in the cloud (P2a §L.3). */
export const HEX6_PATTERN = /^[0-9a-fA-F]{6}$/;
/** Bundled icon keys, e.g. "flask" (P2a §L.3). */
export const ICON_PATTERN = /^[a-z0-9-]{1,40}$/;

export const TEXT_LIMITS = {
  subjectName: 80,
  folderName: 80,
  noteTitle: 200,
  tag: 40,
  cardFront: 2_000,
  cardBack: 2_000,
} as const;

export const LIST_LIMITS = { tags: 20, examDates: 10, bookmarks: 500 } as const;

/** Note document JSON caps (P2a §L.6): characters (rules) and UTF-8 bytes (zod). */
export const DOCUMENT_LIMITS = {
  maxChars: 600_000,
  maxBytes: 900_000,
  /** The editor warns when a note passes this share of either cap. */
  warnRatio: 0.8,
} as const;

export const SETTINGS_MAX_CHARS = 8_000;

/** A string bounded in UTF-16 units, matching Firestore rules. */
export function utf16String(min: number, max: number) {
  return z
    .string()
    .refine((s) => s.length >= min, { message: `at least ${min}` })
    .refine((s) => s.length <= max, { message: `at most ${max}` });
}

/** Unique list of bounded strings (tags). */
export function utf16StringList(maxItems: number, itemMin: number, itemMax: number) {
  return z
    .array(utf16String(itemMin, itemMax))
    .max(maxItems)
    .refine((a) => new Set(a).size === a.length, { message: 'items must be unique' });
}

export const entityIdSchema = z.string().regex(ENTITY_ID_PATTERN);
export const refIdSchema = z.string().regex(REF_ID_PATTERN);
