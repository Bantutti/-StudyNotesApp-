/**
 * firestore.lifecycle.test.ts — the request-time rules zod can't express:
 * server timestamps, immutable fields, the rev counter (conflict detection),
 * tombstones vs hard delete, and the account-deletion state.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { ALICE, createEnv, seedUser, verifiedCtx } from '../helpers/env.js';
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
});

const db = () => verifiedCtx(env, ALICE).firestore();

async function seed(collectionName: string, d: AnyDoc): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionName, String(d.id)), d);
  });
}

describe('create', () => {
  it('created/updated must be server time (a client clock value is denied)', async () => {
    const d = validDoc('notes', ALICE);
    await assertFails(setDoc(doc(db(), 'notes', String(d.id)), { ...toCreatePayload('notes', d), created: Timestamp.now() }));
    await assertFails(setDoc(doc(db(), 'notes', String(d.id)), { ...toCreatePayload('notes', d), updated: Timestamp.now() }));
    await assertSucceeds(setDoc(doc(db(), 'notes', String(d.id)), toCreatePayload('notes', d)));
  });

  it('rev must start at 1, id must equal the doc id, and docs cannot be born deleted', async () => {
    const d = validDoc('cards', ALICE);
    await assertFails(setDoc(doc(db(), 'cards', String(d.id)), { ...toCreatePayload('cards', d), rev: 2 }));
    await assertFails(setDoc(doc(db(), 'cards', 'someOtherId0000000001'), toCreatePayload('cards', d)));
    await assertFails(setDoc(doc(db(), 'cards', String(d.id)), { ...toCreatePayload('cards', d), deleted: true }));
  });

  it('a write is denied when the profile doc does not exist yet', async () => {
    await env.clearFirestore(); // no users/{ALICE}
    const d = validDoc('notes', ALICE);
    await assertFails(setDoc(doc(db(), 'notes', String(d.id)), toCreatePayload('notes', d)));
  });

  it('a 500-write batch (guest-to-account upload) is accepted', async () => {
    const fs = db(); // one Firestore instance for the batch and all its refs
    const batch = writeBatch(fs);
    for (let i = 0; i < 500; i++) {
      const d = validDoc('cards', ALICE);
      batch.set(doc(fs, 'cards', String(d.id)), toCreatePayload('cards', d));
    }
    await assertSucceeds(batch.commit());
  });
});

describe('update', () => {
  it('rev must be exactly old + 1; a stale write (old rev) is denied', async () => {
    const d = validDoc('notes', ALICE);
    await seed('notes', d); // rev 1
    const ref = doc(db(), 'notes', String(d.id));
    await assertSucceeds(updateDoc(ref, { title: 'v2', updated: serverTimestamp(), rev: 2 }));
    // A second device that still thinks rev is 1 sends rev 2 again -> conflict.
    await assertFails(updateDoc(ref, { title: 'stale', updated: serverTimestamp(), rev: 2 }));
    // Skipping ahead is also denied.
    await assertFails(updateDoc(ref, { title: 'skip', updated: serverTimestamp(), rev: 9 }));
    await assertSucceeds(updateDoc(ref, { title: 'v3', updated: serverTimestamp(), rev: 3 }));
  });

  it('updated must be server time on every update', async () => {
    const d = validDoc('notes', ALICE);
    await seed('notes', d);
    await assertFails(updateDoc(doc(db(), 'notes', String(d.id)), { title: 'x', updated: Timestamp.now(), rev: 2 }));
  });

  it('id, owner and created are immutable', async () => {
    const d = validDoc('subjects', ALICE);
    await seed('subjects', d);
    const ref = doc(db(), 'subjects', String(d.id));
    await assertFails(updateDoc(ref, { created: serverTimestamp(), updated: serverTimestamp(), rev: 2 }));
    await assertFails(updateDoc(ref, { id: 'changedId00000000000001', updated: serverTimestamp(), rev: 2 }));
    await assertFails(updateDoc(ref, { owner: 'someoneElse', updated: serverTimestamp(), rev: 2 }));
  });

  it('an update must still pass full validation (e.g. oversized title denied)', async () => {
    const d = validDoc('notes', ALICE);
    await seed('notes', d);
    await assertFails(updateDoc(doc(db(), 'notes', String(d.id)), { title: 'a'.repeat(201), updated: serverTimestamp(), rev: 2 }));
    await assertFails(updateDoc(doc(db(), 'notes', String(d.id)), { extra: 1, updated: serverTimestamp(), rev: 2 }));
  });

  it('tombstoning (deleted: true) and restoring are normal updates', async () => {
    const d = validDoc('folders', ALICE);
    await seed('folders', d);
    const ref = doc(db(), 'folders', String(d.id));
    await assertSucceeds(updateDoc(ref, { deleted: true, updated: serverTimestamp(), rev: 2 }));
    await assertSucceeds(updateDoc(ref, { deleted: false, updated: serverTimestamp(), rev: 3 }));
  });
});

describe('hard delete', () => {
  it('a live (non-tombstoned) doc cannot be hard-deleted', async () => {
    const d = validDoc('notes', ALICE);
    await seed('notes', d);
    await assertFails(deleteDoc(doc(db(), 'notes', String(d.id))));
  });

  it('a tombstoned doc can be hard-deleted by its owner', async () => {
    const d: AnyDoc = { ...validDoc('notes', ALICE), deleted: true };
    await seed('notes', d);
    await assertSucceeds(deleteDoc(doc(db(), 'notes', String(d.id))));
  });
});

describe('account deletion state (users/{uid}.deletionRequestedAt)', () => {
  async function startDeletion(): Promise<void> {
    await assertSucceeds(updateDoc(doc(db(), 'users', ALICE), { deletionRequestedAt: serverTimestamp(), updated: serverTimestamp(), rev: 2 }));
  }

  it('deletionRequestedAt can only be set to server time (no backdating)', async () => {
    await assertFails(
      updateDoc(doc(db(), 'users', ALICE), { deletionRequestedAt: Timestamp.fromMillis(0), updated: serverTimestamp(), rev: 2 }),
    );
    await startDeletion();
  });

  it('once deletion starts, new creates and updates are denied everywhere', async () => {
    const live = validDoc('notes', ALICE);
    await seed('notes', live);
    await startDeletion();
    const fresh = validDoc('notes', ALICE);
    await assertFails(setDoc(doc(db(), 'notes', String(fresh.id)), toCreatePayload('notes', fresh)));
    await assertFails(updateDoc(doc(db(), 'notes', String(live.id)), { title: 'x', updated: serverTimestamp(), rev: 2 }));
    const log = validDoc('reviewLogs', ALICE);
    await assertFails(setDoc(doc(db(), 'reviewLogs', String(log.id)), toCreatePayload('reviewLogs', log)));
  });

  it('once deletion starts, live docs CAN be hard-deleted', async () => {
    const live = validDoc('cards', ALICE);
    await seed('cards', live);
    await startDeletion();
    await assertSucceeds(deleteDoc(doc(db(), 'cards', String(live.id))));
  });

  it('the profile can be deleted only after deletion was requested', async () => {
    await assertFails(deleteDoc(doc(db(), 'users', ALICE)));
    await startDeletion();
    await assertSucceeds(deleteDoc(doc(db(), 'users', ALICE)));
  });

  it('after the profile is gone, nothing can be written (no orphan data)', async () => {
    await startDeletion();
    await assertSucceeds(deleteDoc(doc(db(), 'users', ALICE)));
    const fresh = validDoc('notes', ALICE);
    await assertFails(setDoc(doc(db(), 'notes', String(fresh.id)), toCreatePayload('notes', fresh)));
  });

  it('deletion can be cancelled by clearing the field', async () => {
    await startDeletion();
    await assertSucceeds(updateDoc(doc(db(), 'users', ALICE), { deletionRequestedAt: null, updated: serverTimestamp(), rev: 3 }));
  });
});
