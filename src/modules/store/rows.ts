/**
 * Row <-> domain mapping and input cleaning shared by the repositories.
 * Rows come from our own database, but P2b will write cloud data into it,
 * so every JSON column is parsed defensively (bad data -> safe default).
 */
import * as z from 'zod';

import type { SqlRow, SqlValue } from './sql';
import type { SyncedMeta } from './types';

export const bool = (v: unknown): boolean => v === 1 || v === true;
export const int01 = (v: boolean): number => (v ? 1 : 0);
export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function jsonList<T>(v: unknown, item: z.ZodType<T>): T[] {
  if (typeof v !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(v);
    if (!Array.isArray(parsed)) return [];
    const out: T[] = [];
    for (const x of parsed) {
      const r = item.safeParse(x);
      if (r.success) out.push(r.data);
    }
    return out;
  } catch {
    return [];
  }
}

export function metaFromRow(r: SqlRow): SyncedMeta {
  return {
    id: str(r.id),
    owner: strOrNull(r.owner),
    created: num(r.created),
    updated: num(r.updated),
    rev: num(r.rev),
    deleted: bool(r.deleted),
  };
}

/**
 * Removes control characters, zero-width characters and bidi overrides
 * (used for spoofing), collapses whitespace and trims. For names, titles
 * and tags: never for note content.
 */
export function cleanLine(s: string): string {
  return s
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `IN (?, ?, ?)` placeholder list for a fixed-length array of values. */
export function inList(values: readonly SqlValue[]): string {
  return `(${values.map(() => '?').join(', ')})`;
}
