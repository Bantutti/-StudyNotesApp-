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
import { mapSampleAttrs, P0_SAMPLE_NOTE } from '../helpers/p0-sample.js';

const block = (id: string, extra: Record<string, unknown> = {}) => ({ type: 'paragraph', attrs: { blockId: id, ...extra }, content: [{ type: 'text', text: 'x' }] });
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
    const tooDeep = docOf({ ...node, attrs: { blockId: 'a' } });
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

/**
 * attrs.blockId fix (Rey, 2026-11-01). Block ids use P0's field name,
 * attrs.blockId, everywhere. DATA_MODEL §D.4.3:
 *   Rule A  top-level block: non-null string blockId required
 *   Rule B  deeper node: blockId optional, null allowed
 *   Rule C  every string blockId matches BLOCK_ID_PATTERN and is unique in the note
 */
describe('attrs.blockId (DATA_MODEL §D.4.3)', () => {
  // Helper: first issue message, so tests can check WHY a note failed, not just that it did.
  const firstMessage = (doc: unknown): string | undefined => noteDocumentSchema.safeParse(doc).error?.issues[0]?.message;

  it("(a) accepts P0's SAMPLE note verbatim: nested blocks, definition term, highlight marks", () => {
    expect(noteDocumentSchema.safeParse(P0_SAMPLE_NOTE).success).toBe(true);
  });

  it('(a) accepts a note with P0-generator ids ("b_" + 16 chars) end to end through noteSchema', () => {
    // Same alphabet and length as P0's createIdGenerator (src/core/ids.ts on main).
    const doc = docOf(
      { type: 'heading', attrs: { level: 1, blockId: 'b_3kQ9mZ7xR2tV8wYp' }, content: [{ type: 'text', text: 'Cell transport' }] },
      {
        type: 'definition',
        attrs: { term: 'Diffusion', blockId: 'b_H4nB6cD1fG5jK8Ls' },
        content: [{ type: 'paragraph', attrs: { blockId: 'b_q2W3e4R5t6Y7u8P9' }, content: [{ type: 'text', text: 'High to low concentration.' }] }],
      },
      {
        type: 'bulletList',
        attrs: { blockId: 'b_aB0cD1eF2gH3jK4m' },
        content: [
          {
            type: 'listItem',
            attrs: { blockId: 'b_N5pQ6rS7tV8wX9yZ' },
            content: [{ type: 'paragraph', attrs: { blockId: 'b_zY9xW8vT7sR6qP5n' }, content: [{ type: 'text', text: 'No ATP needed' }] }],
          },
        ],
      },
    );
    expect(noteDocumentSchema.safeParse(doc).success).toBe(true);
    // And through the real collection schema, where the document is a JSON string.
    expect(noteSchema.safeParse({ ...validDoc('notes', ALICE), document: JSON.stringify(doc) }).success).toBe(true);
  });

  it('(b) rejects a top-level block that uses attrs.id instead of attrs.blockId, and names the old key', () => {
    expect(noteDocumentSchema.safeParse(docOf({ type: 'paragraph', attrs: { id: 'b_0000000000000001' }, content: [] })).success).toBe(false);
    expect(firstMessage(docOf({ type: 'paragraph', attrs: { id: 'b_0000000000000001' } }))).toMatch(/found attrs\.id/);
  });

  it("(b) rejects P0's sample with every blockId renamed to id", () => {
    const renamed = mapSampleAttrs(({ blockId, ...rest }) => ({ ...rest, id: blockId }));
    expect(noteDocumentSchema.safeParse(renamed).success).toBe(false);
  });

  it('(c) rejects a top-level blockId: null (the gap closed on 2026-11-01)', () => {
    expect(noteDocumentSchema.safeParse(docOf({ type: 'paragraph', attrs: { blockId: null }, content: [] })).success).toBe(false);
    expect(firstMessage(docOf({ type: 'paragraph', attrs: { blockId: null } }))).toBe('Top-level block needs a non-null attrs.blockId');
  });

  it("(c) rejects a P0 note whose ids were stripped to null (P0 makeLongSample style) until ids are assigned", () => {
    // P0's makeLongSample() sets every blockId to null; ensureBlockIds() must run before upload.
    const stripped = mapSampleAttrs((a) => ({ ...a, blockId: null }));
    expect(noteDocumentSchema.safeParse(stripped).success).toBe(false);
  });

  it('Rule B: deeper blocks may omit blockId or set it to null', () => {
    const doc = docOf({
      type: 'bulletList',
      attrs: { blockId: 'top1' },
      content: [
        { type: 'listItem', attrs: { blockId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
      ],
    });
    expect(noteDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('Rule C: ids are unique across the whole note, including top-level vs nested', () => {
    const dup = docOf(block('same'), { type: 'callout', attrs: { blockId: 'top2' }, content: [block('same')] });
    expect(firstMessage(dup)).toBe('Duplicate attrs.blockId "same"');
  });

  it.each([
    ['a', true],
    ['A-z_0-9', true],
    ['x'.repeat(64), true],
    ['x'.repeat(65), false],
    ['', false],
    ['bad id!', false],
    [42, false],
  ])('Rule C: blockId %j valid = %s (pattern 1 to 64 of A-Z a-z 0-9 _ -)', (blockId, ok) => {
    const doc = docOf({ type: 'paragraph', attrs: { blockId }, content: [] });
    expect(noteDocumentSchema.safeParse(doc).success).toBe(ok);
    // The same pattern applies to nested ids (null/missing aside).
    const nested = docOf({ type: 'callout', attrs: { blockId: 'top3' }, content: [{ type: 'paragraph', attrs: { blockId } }] });
    expect(noteDocumentSchema.safeParse(nested).success).toBe(ok);
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
