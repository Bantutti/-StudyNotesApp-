/**
 * firestore.access.test.ts — WHO can reach WHAT.
 * Identity (signed out, unverified), ownership (Alice vs Bob), query shape
 * (owner filter, page limit) and paths that must stay closed.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { ALICE, BOB, createEnv, seedUser, unverifiedCtx, verifiedCtx } from '../helpers/env.js';
import { toCreatePayload, validDoc } from '../helpers/fixtures.js';

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
  await seedUser(env, BOB);
});

/** Seeds Alice's note directly (rules off) and returns its id. */
async function seedAliceNote(): Promise<string> {
  const note = validDoc('notes', ALICE);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'notes', String(note.id)), note);
  });
  return String(note.id);
}

describe('identity', () => {
  it('signed-out callers can read nothing and write nothing', async () => {
    const id = await seedAliceNote();
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'notes', id)));
    await assertFails(getDoc(doc(db, 'users', ALICE)));
    const fresh = validDoc('notes', ALICE);
    await assertFails(setDoc(doc(db, 'notes', String(fresh.id)), toCreatePayload('notes', fresh)));
  });

  it('a user whose email is NOT verified is denied even on their own data', async () => {
    const id = await seedAliceNote();
    const db = unverifiedCtx(env, ALICE).firestore();
    await assertFails(getDoc(doc(db, 'notes', id)));
    const fresh = validDoc('notes', ALICE);
    await assertFails(setDoc(doc(db, 'notes', String(fresh.id)), toCreatePayload('notes', fresh)));
  });

  it('an anonymous-provider token (guest) is denied', async () => {
    const db = env.authenticatedContext(ALICE, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
    await assertFails(getDoc(doc(db, 'users', ALICE)));
  });
});

describe('ownership', () => {
  it('Alice can read her own note', async () => {
    const id = await seedAliceNote();
    await assertSucceeds(getDoc(doc(verifiedCtx(env, ALICE).firestore(), 'notes', id)));
  });

  it("Bob cannot read, update or delete Alice's note", async () => {
    const id = await seedAliceNote();
    const db = verifiedCtx(env, BOB).firestore();
    await assertFails(getDoc(doc(db, 'notes', id)));
    await assertFails(updateDoc(doc(db, 'notes', id), { title: 'pwned', updated: serverTimestamp(), rev: 2 }));
    await assertFails(deleteDoc(doc(db, 'notes', id)));
  });

  it("Bob cannot create a doc that claims Alice as owner", async () => {
    const forged = validDoc('notes', ALICE);
    await assertFails(setDoc(doc(verifiedCtx(env, BOB).firestore(), 'notes', String(forged.id)), toCreatePayload('notes', forged)));
  });

  it("Bob cannot take over Alice's doc by overwriting it with himself as owner", async () => {
    const id = await seedAliceNote();
    const takeover = { ...validDoc('notes', BOB, id), rev: 2 };
    await assertFails(setDoc(doc(verifiedCtx(env, BOB).firestore(), 'notes', id), toCreatePayload('notes', takeover)));
  });

  it("Bob cannot read Alice's profile; nobody can list profiles", async () => {
    await assertFails(getDoc(doc(verifiedCtx(env, BOB).firestore(), 'users', ALICE)));
    await assertSucceeds(getDoc(doc(verifiedCtx(env, ALICE).firestore(), 'users', ALICE)));
    await assertFails(getDocs(query(collection(verifiedCtx(env, ALICE).firestore(), 'users'), limit(10))));
  });

  it('reading a missing id is denied (does not reveal whether it exists)', async () => {
    await assertFails(getDoc(doc(verifiedCtx(env, ALICE).firestore(), 'notes', 'doesNotExist0000000001')));
  });
});

describe('queries', () => {
  it('owner-filtered query with limit <= 500 is allowed', async () => {
    await seedAliceNote();
    const db = verifiedCtx(env, ALICE).firestore();
    await assertSucceeds(getDocs(query(collection(db, 'notes'), where('owner', '==', ALICE), limit(500))));
  });

  it('a query without the owner filter is denied', async () => {
    const db = verifiedCtx(env, ALICE).firestore();
    await assertFails(getDocs(query(collection(db, 'notes'), limit(10))));
  });

  it("a query filtering on someone else's uid is denied", async () => {
    const db = verifiedCtx(env, BOB).firestore();
    await assertFails(getDocs(query(collection(db, 'notes'), where('owner', '==', ALICE), limit(10))));
  });

  it('a query without a limit, or with limit > 500, is denied', async () => {
    const db = verifiedCtx(env, ALICE).firestore();
    await assertFails(getDocs(query(collection(db, 'notes'), where('owner', '==', ALICE))));
    await assertFails(getDocs(query(collection(db, 'notes'), where('owner', '==', ALICE), limit(501))));
  });
});

describe('closed paths', () => {
  it('local-only entities (noteVersions, aiJobs) and unknown collections are denied', async () => {
    const db = verifiedCtx(env, ALICE).firestore();
    for (const c of ['noteVersions', 'aiJobs', 'anything', 'admin']) {
      await assertFails(setDoc(doc(db, c, 'x0000000000000000001'), { owner: ALICE }));
      await assertFails(getDoc(doc(db, c, 'x0000000000000000001')));
    }
  });

  it('subcollections under a user doc are denied (layout is top-level only)', async () => {
    const db = verifiedCtx(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, 'users', ALICE, 'notes', 'x0000000000000000001'), { owner: ALICE }));
  });
});
