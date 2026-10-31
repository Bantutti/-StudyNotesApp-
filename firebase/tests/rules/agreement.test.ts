/**
 * agreement.test.ts — proves the zod schemas and firestore.rules agree.
 *
 * For every collection and every field, generated boundary mutations
 * (tests/helpers/mutations.ts) are applied to a valid fixture. Each mutated
 * doc is (1) parsed by zod and (2) written through the real rules by its
 * owner. Both must give the same verdict, except KNOWN_GAPS (rules weaker by
 * design), where we assert exactly that direction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { COLLECTION_NAMES } from '../../src/schemas/collections.js';
import { ALICE, createEnv, seedUser, verifiedCtx } from '../helpers/env.js';
import { schemaFor, toCreatePayload, validDoc, type FixtureCollection } from '../helpers/fixtures.js';
import { applyMutation, isKnownGap, mutationsFor } from '../helpers/mutations.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createEnv();
  await env.clearFirestore();
});
afterAll(async () => {
  await env.cleanup();
});

/** Try a create through the rules; true = accepted. */
async function rulesAccept(collection: FixtureCollection, docId: string, payload: Record<string, unknown>): Promise<boolean> {
  const db = verifiedCtx(env, ALICE).firestore();
  try {
    await setDoc(doc(db, collection, docId), payload);
    return true;
  } catch {
    return false;
  }
}

const ALL: FixtureCollection[] = ['users', ...COLLECTION_NAMES];

describe.each(ALL)('%s: zod and rules agree', (collection) => {
  beforeAll(async () => {
    await env.clearFirestore();
    // Every collection except users needs an active profile to accept writes.
    if (collection !== 'users') await seedUser(env, ALICE);
  });

  it('valid fixture is accepted by both', async () => {
    const valid = validDoc(collection, ALICE);
    expect(schemaFor(collection).safeParse(valid).success).toBe(true);
    const id = collection === 'users' ? ALICE : String(valid.id);
    expect(await rulesAccept(collection, id, toCreatePayload(collection, valid))).toBe(true);
    if (collection === 'users') await env.clearFirestore(); // so the next create is a create again
  });

  const template = validDoc(collection, ALICE);
  const mutations = mutationsFor(schemaFor(collection), template);

  it.each(mutations.map((m) => [m.name, m] as const))('%s', async (_name, m) => {
    // Fresh valid doc + fresh id per case, so creates never collide.
    const valid = validDoc(collection, ALICE);
    const mutated = applyMutation(valid, m);
    // Path id: users/{uid}; otherwise the (possibly mutated) id when it's a string.
    const docId = collection === 'users' ? ALICE : typeof mutated.id === 'string' && mutated.id.length > 0 ? mutated.id : String(valid.id);

    const zodOk = schemaFor(collection).safeParse(mutated).success;
    const rulesOk = await rulesAccept(collection, docId, toCreatePayload(collection, mutated));
    if (collection === 'users' && rulesOk) await env.clearFirestore();

    if (isKnownGap(m.kind)) {
      // Documented gap: zod must catch it, rules are known not to.
      expect({ zodOk, rulesOk }).toEqual({ zodOk: false, rulesOk: true });
    } else {
      expect({ mutation: m.name, rulesOk }).toEqual({ mutation: m.name, rulesOk: zodOk });
    }
  });
});
