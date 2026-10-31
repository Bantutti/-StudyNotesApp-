/**
 * mutations.ts — generates boundary mutations for EVERY field of a schema,
 * driven by the FieldMeta attached in src/schemas/primitives.ts.
 *
 * The agreement test applies each mutation to a valid fixture and checks that
 * zod and the Firestore rules reach the same verdict (accept / reject), except
 * for the KNOWN_GAPS listed below, where rules are documented to be weaker.
 */
import { Timestamp } from 'firebase/firestore';
import type { z } from 'zod';
import { fieldMetaOf, type FieldMeta } from '../../src/schemas/primitives.js';
import type { AnyDoc } from './fixtures.js';

/** Sentinel meaning "remove this key". */
export const DELETE = Symbol('delete');

export interface Mutation {
  /** e.g. "name.overMax" */
  name: string;
  field: string;
  kind: string;
  value: unknown;
}

/**
 * Lifecycle fields: their *values* are governed by request-time logic in the
 * rules (== doc id, == caller uid, == request.time, rev == 1 on create,
 * deleted == false on create). zod can't know those, so for these fields we
 * only generate the mutations where both sides must agree: missing / wrong type.
 * The value logic is covered by explicit tests in firestore.lifecycle.test.ts.
 */
export const LIFECYCLE_FIELDS = new Set(['id', 'owner', 'schemaVersion', 'created', 'updated', 'rev', 'deleted', 'deletionRequestedAt']);

/**
 * Places where rules are KNOWN to be weaker than zod, by design and documented
 * in docs/backend/SECURITY_REVIEW.md §S.3. For these, the test asserts
 * "zod rejects AND rules accept" — so if the rules ever get stronger, the test
 * fails and tells you to remove the gap entry.
 */
export const KNOWN_GAPS: ReadonlyArray<{ kind: string; reason: string }> = [
  { kind: 'json.invalid', reason: 'Rules cannot parse JSON; zod validates inner JSON on load (§S.3.1).' },
  { kind: 'json.innerBad', reason: 'Rules cannot see inside JSON strings (§S.3.1).' },
  { kind: 'intList.itemWrongType', reason: 'Rules cannot loop over a 500-item list (§S.3.2).' },
  { kind: 'intList.itemOutOfRange', reason: 'Rules cannot loop over a 500-item list (§S.3.2).' },
];

export function isKnownGap(kind: string): boolean {
  return KNOWN_GAPS.some((g) => g.kind === kind);
}

/** A wrong-typed value for each meta kind. */
function wrongTypeFor(meta: FieldMeta): unknown {
  switch (meta.kind) {
    case 'string':
    case 'json':
      return 12345;
    case 'int':
      return '1';
    case 'bool':
      return 'true';
    case 'enum':
      return 1;
    case 'literal':
      return typeof meta.value === 'number' ? String(meta.value) : 1;
    case 'timestamp':
      return '2026-01-01T00:00:00Z';
    case 'stringList':
    case 'intList':
    case 'timestampList':
      return 'not-a-list';
  }
}

/**
 * A string of exactly n chars. 'a' satisfies every pattern we use (ids, hex,
 * icon names), so atMax values stay pattern-valid where the length allows.
 */
function fill(n: number): string {
  return n <= 0 ? '' : 'a'.repeat(n);
}

/** Pads a valid JSON string with trailing spaces (still valid JSON) to exactly n chars. */
function padJson(validRaw: string, n: number): string {
  return validRaw.length >= n ? validRaw : validRaw + ' '.repeat(n - validRaw.length);
}

/** Builds all mutations for one schema, given a valid doc (used for JSON padding). */
export function mutationsFor(schema: z.ZodObject, valid: AnyDoc): Mutation[] {
  const out: Mutation[] = [];
  const push = (field: string, kind: string, value: unknown) => out.push({ name: `${field}.${kind}`, field, kind, value });

  // One unknown key per collection: hasOnly() / strictObject must both reject.
  out.push({ name: '<extra key>', field: 'zzUnknownField', kind: 'extraKey', value: 'x' });

  for (const [field, fieldSchema] of Object.entries(schema.shape) as Array<[string, z.ZodType]>) {
    const info = fieldMetaOf(fieldSchema);
    if (!info) throw new Error(`Field ${field} has no FieldMeta; build it with a primitives.ts helper`);
    const { meta, nullable } = info;

    push(field, 'missing', DELETE);
    push(field, 'wrongType', wrongTypeFor(meta));
    if (LIFECYCLE_FIELDS.has(field)) continue;

    // null is accepted only for .nullable() fields.
    push(field, nullable ? 'nullAllowed' : 'nullRejected', null);

    switch (meta.kind) {
      case 'string':
        push(field, 'atMax', fill(meta.max));
        push(field, 'overMax', fill(meta.max + 1));
        if (meta.min > 0) push(field, 'underMin', fill(meta.min - 1));
        if (meta.pattern) push(field, 'patternBad', '!'.repeat(Math.max(meta.min, 1)));
        if (!meta.pattern && meta.max >= 2) {
          // Unicode boundaries (§L.4): an emoji is 2 UTF-16 units (rules) but 1 code point (zod's own .max).
          push(field, 'emojiAtMax', '😀'.repeat(Math.floor(meta.max / 2)) + (meta.max % 2 ? 'a' : ''));
          push(field, 'emojiOverMax', '😀'.repeat(Math.floor(meta.max / 2) + 1));
        }
        break;
      case 'json': {
        const raw = String(valid[field]);
        push(field, 'atMax', padJson(raw, meta.max));
        push(field, 'overMax', padJson(raw, meta.max + 1));
        // max + 1 UTF-16 units but only max code points: one emoji inside a JSON string value,
        // then space padding. zod's own .max() would wrongly accept this (§L.4).
        push(field, 'emojiOverMax', padJson(raw.replace(/"([^"]*)"/, '"$1😀"'), meta.max + 1));
        push(field, 'underMin', 'x'.repeat(Math.max(meta.min - 1, 0)));
        push(field, 'json.invalid', '{not json');
        // Valid JSON of the wrong shape: an object where an array is expected, or vice versa.
        push(field, 'json.innerBad', raw.trim().startsWith('[') ? '{"wrong":true}' : '[1,2,3]');
        break;
      }
      case 'int':
        push(field, 'atMax', meta.max);
        push(field, 'atMin', meta.min);
        push(field, 'overMax', meta.max + 1);
        push(field, 'underMin', meta.min - 1);
        push(field, 'nonInteger', meta.min + 0.5);
        break;
      case 'bool':
        push(field, 'flipped', !(valid[field] as boolean));
        break;
      case 'enum':
        for (const v of meta.values) push(field, `value:${v}`, v);
        push(field, 'bogus', 'zz-not-allowed');
        break;
      case 'literal':
        push(field, 'other', typeof meta.value === 'number' ? meta.value + 1 : `${meta.value}x`);
        break;
      case 'timestamp':
        break; // client timestamps: type checks above are the boundary
      case 'stringList':
        push(field, 'atMaxItems', Array.from({ length: meta.maxItems }, (_, i) => `t${i}`));
        push(field, 'overMaxItems', Array.from({ length: meta.maxItems + 1 }, (_, i) => `t${i}`));
        push(field, 'empty', []);
        push(field, 'itemTooLong', ['a'.repeat(meta.itemMax + 1)]);
        push(field, 'itemAtMax', ['a'.repeat(meta.itemMax)]);
        if (meta.itemMin > 0) push(field, 'itemEmpty', ['']);
        push(field, 'itemWrongType', [1]);
        push(field, 'duplicates', ['x', 'x']);
        push(field, 'itemEmojiOverMax', ['😀'.repeat(Math.floor(meta.itemMax / 2) + 1)]);
        break;
      case 'intList':
        push(field, 'atMaxItems', Array.from({ length: meta.maxItems }, (_, i) => i));
        push(field, 'overMaxItems', Array.from({ length: meta.maxItems + 1 }, (_, i) => i));
        push(field, 'intList.itemWrongType', ['x']);
        push(field, 'intList.itemOutOfRange', [-1]);
        break;
      case 'timestampList':
        push(field, 'atMaxItems', Array.from({ length: meta.maxItems }, (_, i) => Timestamp.fromMillis(1_800_000_000_000 + i)));
        push(field, 'overMaxItems', Array.from({ length: meta.maxItems + 1 }, (_, i) => Timestamp.fromMillis(1_800_000_000_000 + i)));
        push(field, 'itemWrongType', ['2026-12-10']);
        break;
    }
  }
  return out;
}

/** Applies a mutation to a copy of `valid`. */
export function applyMutation(valid: AnyDoc, m: Mutation): AnyDoc {
  if (m.value === DELETE) return Object.fromEntries(Object.entries(valid).filter(([k]) => k !== m.field));
  return { ...valid, [m.field]: m.value };
}
