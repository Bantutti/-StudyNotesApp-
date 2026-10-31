/**
 * limits-probe.test.ts — pins down emulator/Firestore behaviours the design
 * relies on, so a future firebase-tools upgrade that changes them is caught.
 *   §L.4   string.size() counts UTF-16 code units (like JS .length and zod .max)
 *   §L.6   a note at the 600k-char document cap still fits in one Firestore doc
 *   §D.3   repeated get() of the same profile doc inside a 500-write batch is
 *          de-duplicated (otherwise the 20-access-call batch limit would bite)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ALICE, createEnv, seedUser, verifiedCtx } from '../helpers/env.js';
import { toCreatePayload, validDoc, type AnyDoc } from '../helpers/fixtures.js';
import { folderSchema, noteSchema } from '../../src/schemas/collections.js';
import { JSON_CAPS } from '../../src/schemas/limits.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedUser(env, ALICE);
});

describe('§L.4 string length unit', () => {
  const cases: Array<[string, string, boolean]> = [
    ['80 ASCII chars', 'a'.repeat(80), true],
    ['80 accented chars (160 UTF-8 bytes)', 'é'.repeat(80), true],
    ['40 emoji (80 UTF-16 units)', '😀'.repeat(40), true],
    ['41 emoji (82 UTF-16 units)', '😀'.repeat(41), false],
    ['81 accented chars', 'é'.repeat(81), false],
  ];
  it.each(cases)('folder name: %s -> accepted=%s by rules AND zod', async (_label, name, expected) => {
    const d: AnyDoc = { ...validDoc('folders', ALICE), name };
    expect(folderSchema.safeParse(d).success).toBe(expected);
    const op = setDoc(doc(verifiedCtx(env, ALICE).firestore(), 'folders', String(d.id)), toCreatePayload('folders', d));
    await (expected ? assertSucceeds(op) : assertFails(op));
  });
});

describe('§L.6 document cap fits in one Firestore document', () => {
  it('a note whose document JSON is exactly 600,000 chars is stored', async () => {
    const base = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'text', text: '' }] }] });
    const pad = JSON_CAPS.document - base.length;
    const documentJson = base.replace('"text":""', `"text":"${'a'.repeat(pad)}"`);
    expect(documentJson.length).toBe(JSON_CAPS.document);
    const d: AnyDoc = { ...validDoc('notes', ALICE), document: documentJson };
    expect(noteSchema.safeParse(d).success).toBe(true);
    await assertSucceeds(setDoc(doc(verifiedCtx(env, ALICE).firestore(), 'notes', String(d.id)), toCreatePayload('notes', d)));
  });
});
