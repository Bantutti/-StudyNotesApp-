/**
 * schemas.test.ts — zod-only checks (no emulator needed: `npm run test:unit`).
 * Covers what the rules cannot see: inside the JSON strings, cross-field
 * rules, the UTF-8 byte cap, and the portable byte counter.
 */
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { assetSchema, noteSchema, recordingSchema, reviewLogSchema, stylePackSchema } from '../../src/schemas/collections.js';
import { noteDocumentSchema, segmentsSchema } from '../../src/schemas/content.js';
import { JSON_INNER } from '../../src/schemas/limits.js';
import { utf8ByteLength } from '../../src/schemas/primitives.js';
import { ALICE } from '../helpers/env.js';
import { validDoc, VALID_DOCUMENT_JSON } from '../helpers/fixtures.js';

const block = (id: string, extra: Record<string, unknown> = {}) => ({ type: 'paragraph', attrs: { id, ...extra }, content: [{ type: 'text', text: 'x' }] });
const docOf = (...content: unknown[]) => ({ type: 'doc', content });

describe('utf8ByteLength (portable, Hermes-safe)', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['é', 2],
    ['€', 3],
    ['😀', 4],
    ['Sugbo 😀 é', 13],
  ])('%j -> %d bytes', (s, n) => {
    expect(utf8ByteLength(s)).toBe(n);
    expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
  });
});

describe('note document (inside the JSON string)', () => {
  it('accepts the fixture document', () => {
    expect(noteDocumentSchema.safeParse(JSON.parse(VALID_DOCUMENT_JSON)).success).toBe(true);
  });

  it('rejects a root that is not { type: doc, content: [] }', () => {
    expect(noteDocumentSchema.safeParse({ type: 'paragraph', content: [] }).success).toBe(false);
    expect(noteDocumentSchema.safeParse([]).success).toBe(false);
  });

  it('requires a block id on every top-level block, unique across the document', () => {
    expect(noteDocumentSchema.safeParse(docOf({ type: 'paragraph', content: [] })).success).toBe(false);
    expect(noteDocumentSchema.safeParse(docOf(block('a'), block('a'))).success).toBe(false);
    expect(noteDocumentSchema.safeParse(docOf(block('a'), block('b'))).success).toBe(true);
    expect(noteDocumentSchema.safeParse(docOf(block('bad id!'))).success).toBe(false);
  });

  it('validates audio anchors (recording id, start ms <= end ms)', () => {
    const ok = { recordingId: 'rec0000000000000001', startMs: 10, endMs: 20 };
    expect(noteDocumentSchema.safeParse(docOf(block('a', { audioAnchor: ok }))).success).toBe(true);
    expect(noteDocumentSchema.safeParse(docOf(block('a', { audioAnchor: null }))).success).toBe(true);
    expect(noteDocumentSchema.safeParse(docOf(block('a', { audioAnchor: { ...ok, endMs: 5 } }))).success).toBe(false);
    expect(noteDocumentSchema.safeParse(docOf(block('a', { audioAnchor: { ...ok, extra: 1 } }))).success).toBe(false);
  });

  it('rejects unknown node keys (e.g. smuggled html)', () => {
    expect(noteDocumentSchema.safeParse(docOf({ ...block('a'), html: '<img onerror=alert(1)>' })).success).toBe(false);
  });

  it(`rejects documents deeper than ${JSON_INNER.documentMaxDepth} levels without overflowing the stack`, () => {
    let node: Record<string, unknown> = { type: 'text', text: 'deep' };
    for (let i = 0; i < 10_000; i++) node = { type: 'blockquote', content: [node] };
    const tooDeep = docOf({ ...node, attrs: { id: 'a' } });
    expect(noteDocumentSchema.safeParse(tooDeep).success).toBe(false);
  });

  it(`rejects more than ${JSON_INNER.documentMaxNodes} nodes`, () => {
    const blocks = Array.from({ length: JSON_INNER.documentMaxNodes }, (_, i) => block(`b${i}`));
    expect(noteDocumentSchema.safeParse(docOf(...blocks)).success).toBe(false);
  });

  it('the note schema enforces the UTF-8 byte cap even when the char count is under the cap', () => {
    // 500k chars of 2-byte "é" = 1,000,000 bytes > 900,000 byte cap, but < 600k chars.
    const big = VALID_DOCUMENT_JSON.replace('Osmosis', 'é'.repeat(500_000));
    expect(big.length).toBeLessThan(600_000);
    const d = { ...validDoc('notes', ALICE), document: big };
    expect(noteSchema.safeParse(d).success).toBe(false);
  });
});

describe('recording segments', () => {
  it('requires unique ids and end >= start', () => {
    expect(segmentsSchema.safeParse([{ id: 's1', start: 0, end: 1, text: '' }]).success).toBe(true);
    expect(segmentsSchema.safeParse([{ id: 's1', start: 5, end: 1, text: '' }]).success).toBe(false);
    expect(segmentsSchema.safeParse([{ id: 's1', start: 0, end: 1, text: '' }, { id: 's1', start: 1, end: 2, text: '' }]).success).toBe(false);
  });

  it('bookmarks must be non-negative integer ms (zod-only; rules check list size)', () => {
    const r = validDoc('recordings', ALICE);
    expect(recordingSchema.safeParse({ ...r, bookmarks: [-1] }).success).toBe(false);
    expect(recordingSchema.safeParse({ ...r, bookmarks: [1.5] }).success).toBe(false);
  });
});

describe('asset cross-field checks', () => {
  it('cloudPath must be users/{owner}/{folder-for-type}/{id}.{ext}', () => {
    const a = validDoc('assets', ALICE);
    expect(assetSchema.safeParse(a).success).toBe(true);
    expect(assetSchema.safeParse({ ...a, cloudPath: `users/someoneElse/audio/${String(a.id)}.m4a` }).success).toBe(false);
    expect(assetSchema.safeParse({ ...a, cloudPath: `users/${ALICE}/images/${String(a.id)}.m4a` }).success).toBe(false);
    expect(assetSchema.safeParse({ ...a, cloudPath: `users/${ALICE}/audio/${String(a.id)}.exe` }).success).toBe(false);
    expect(assetSchema.safeParse({ ...a, cloudPath: null }).success).toBe(true);
  });

  it('size is capped per type (image 5 MiB even though audio allows 64 MiB)', () => {
    const a = { ...validDoc('assets', ALICE), type: 'image', cloudPath: null };
    expect(assetSchema.safeParse({ ...a, size: 5 * 1024 * 1024 }).success).toBe(true);
    expect(assetSchema.safeParse({ ...a, size: 5 * 1024 * 1024 + 1 }).success).toBe(false);
  });
});

describe('misc', () => {
  it('a plain object with the right shape is not a Timestamp', () => {
    const log = validDoc('reviewLogs', ALICE);
    expect(reviewLogSchema.safeParse({ ...log, reviewedAt: { seconds: 1, nanoseconds: 0 } }).success).toBe(false);
    expect(reviewLogSchema.safeParse({ ...log, reviewedAt: Timestamp.now() }).success).toBe(true);
  });

  it('pack definition must be a JSON object, not an array or a scalar', () => {
    const p = validDoc('stylePacks', ALICE);
    expect(stylePackSchema.safeParse({ ...p, definition: '[1]' }).success).toBe(false);
    expect(stylePackSchema.safeParse({ ...p, definition: '42' }).success).toBe(false);
  });
});
