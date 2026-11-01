/**
 * firestore.reviewLogs.test.ts — append-only review logs (Plan §12).
 * Create once; never update; re-sending the same id fails; delete only during
 * account deletion or once the card is tombstoned (decision 4).
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { ALICE, BOB, createEnv, seedUser, verifiedCtx } from '../helpers/env.js';
import { toCreatePayload, validDoc, type AnyDoc } from '../helpers/fixtures.js';

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

const db = (uid = ALICE) => verifiedCtx(env, uid).firestore();

async function seed(collectionName: string, d: AnyDoc): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionName, String(d.id)), d);
  });
}

describe('create', () => {
  it('a valid log is accepted', async () => {
    const log = validDoc('reviewLogs', ALICE);
    await assertSucceeds(setDoc(doc(db(), 'reviewLogs', String(log.id)), toCreatePayload('reviewLogs', log)));
  });

  it('re-uploading the same log id is denied (union merge stays idempotent)', async () => {
    const log = validDoc('reviewLogs', ALICE);
    const ref = doc(db(), 'reviewLogs', String(log.id));
    await assertSucceeds(setDoc(ref, toCreatePayload('reviewLogs', log)));
    await assertFails(setDoc(ref, toCreatePayload('reviewLogs', log)));
  });

  it('rating must be an integer 1..4', async () => {
    for (const rating of [0, 5, 2.5, '3']) {
      const log: AnyDoc = { ...validDoc('reviewLogs', ALICE), rating };
      await assertFails(setDoc(doc(db(), 'reviewLogs', String(log.id)), toCreatePayload('reviewLogs', log)));
    }
  });

  it('reviewedAt may be in the past (offline reviews) but not > 5 min in the future', async () => {
    const old: AnyDoc = { ...validDoc('reviewLogs', ALICE), reviewedAt: Timestamp.fromMillis(Date.now() - 7 * 24 * 3600 * 1000) };
    await assertSucceeds(setDoc(doc(db(), 'reviewLogs', String(old.id)), toCreatePayload('reviewLogs', old)));
    const future: AnyDoc = { ...validDoc('reviewLogs', ALICE), reviewedAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000) };
    await assertFails(setDoc(doc(db(), 'reviewLogs', String(future.id)), toCreatePayload('reviewLogs', future)));
  });

  it("Bob cannot add a log into Alice's history", async () => {
    const log = validDoc('reviewLogs', ALICE);
    await assertFails(setDoc(doc(db(BOB), 'reviewLogs', String(log.id)), toCreatePayload('reviewLogs', log)));
  });
});

describe('edits are impossible', () => {
  it('no field of an existing log can be updated, not even by its owner', async () => {
    const log = validDoc('reviewLogs', ALICE);
    await seed('reviewLogs', log);
    const ref = doc(db(), 'reviewLogs', String(log.id));
    await assertFails(updateDoc(ref, { rating: 4 }));
    await assertFails(updateDoc(ref, { reviewedAt: Timestamp.now() }));
    await assertFails(updateDoc(ref, { device: 'other' }));
  });
});

describe('delete', () => {
  it('a log cannot be deleted while its card is live', async () => {
    const card = validDoc('cards', ALICE);
    await seed('cards', card);
    const log: AnyDoc = { ...validDoc('reviewLogs', ALICE), card: card.id };
    await seed('reviewLogs', log);
    await assertFails(deleteDoc(doc(db(), 'reviewLogs', String(log.id))));
  });

  it('a log cannot be deleted when its card does not exist', async () => {
    const log = validDoc('reviewLogs', ALICE);
    await seed('reviewLogs', log);
    await assertFails(deleteDoc(doc(db(), 'reviewLogs', String(log.id))));
  });

  it('a log CAN be deleted once its card is tombstoned', async () => {
    const card: AnyDoc = { ...validDoc('cards', ALICE), deleted: true };
    await seed('cards', card);
    const log: AnyDoc = { ...validDoc('reviewLogs', ALICE), card: card.id };
    await seed('reviewLogs', log);
    await assertSucceeds(deleteDoc(doc(db(), 'reviewLogs', String(log.id))));
  });

  it("a tombstoned card owned by Bob doesn't unlock Alice's log", async () => {
    const bobCard: AnyDoc = { ...validDoc('cards', BOB), deleted: true };
    await seed('cards', bobCard);
    const log: AnyDoc = { ...validDoc('reviewLogs', ALICE), card: bobCard.id };
    await seed('reviewLogs', log);
    await assertFails(deleteDoc(doc(db(), 'reviewLogs', String(log.id))));
  });

  it('a log CAN be deleted during account deletion', async () => {
    const log = validDoc('reviewLogs', ALICE);
    await seed('reviewLogs', log);
    await assertSucceeds(updateDoc(doc(db(), 'users', ALICE), { deletionRequestedAt: serverTimestamp(), updated: serverTimestamp(), rev: 2 }));
    await assertSucceeds(deleteDoc(doc(db(), 'reviewLogs', String(log.id))));
  });

  it("Bob can never delete Alice's logs", async () => {
    const card: AnyDoc = { ...validDoc('cards', ALICE), deleted: true };
    await seed('cards', card);
    const log: AnyDoc = { ...validDoc('reviewLogs', ALICE), card: card.id };
    await seed('reviewLogs', log);
    await assertFails(deleteDoc(doc(db(BOB), 'reviewLogs', String(log.id))));
  });
});
