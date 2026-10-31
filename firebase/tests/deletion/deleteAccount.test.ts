/**
 * deleteAccount.test.ts — end-to-end proof that in-app account deletion leaves
 * NOTHING behind for the user (every collection, every Storage folder, the
 * profile, the Auth account), touches nobody else's data, and resumes after a
 * crash. Runs through the real security rules with a real Auth emulator user.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { listAll, ref, uploadBytes } from 'firebase/storage';
import { deleteAccount, NotSignedInError, ReauthRequiredError } from '../../src/deletion/index.js';
import { COLLECTION_NAMES } from '../../src/schemas/collections.js';
import { STORAGE } from '../../src/schemas/limits.js';
import { BOB, createEnv, seedUser } from '../helpers/env.js';
import { toCreatePayload, validDoc } from '../helpers/fixtures.js';
import { authUserExists, BUCKET, createRealClient, type RealClient } from '../helpers/realClient.js';

let env: RulesTestEnvironment;
let emailCounter = 0;
const nextEmail = () => `user${++emailCounter}-${Date.now()}@example.test`;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
});

/** Seeds a full account THROUGH THE RULES as the real signed-in user. */
async function seedFullAccount(c: RealClient): Promise<void> {
  const fs = c.firestore;
  await setDoc(doc(fs, 'users', c.uid), toCreatePayload('users', validDoc('users', c.uid)));
  for (const name of COLLECTION_NAMES) {
    if (name === 'assets') continue; // assets are seeded with their files below
    for (let i = 0; i < 3; i++) {
      const d = validDoc(name, c.uid);
      await setDoc(doc(fs, name, String(d.id)), toCreatePayload(name, d));
    }
  }
  // Assets + files: one per Storage folder.
  const files: Array<['audio' | 'image' | 'ink' | 'pdf', string, string, string]> = [
    ['audio', 'audio', 'm4a', 'audio/mp4'],
    ['image', 'images', 'png', 'image/png'],
    ['ink', 'ink', 'json', 'application/json'],
    ['pdf', 'attachments', 'pdf', 'application/pdf'],
  ];
  for (const [type, folder, ext, contentType] of files) {
    const a = validDoc('assets', c.uid);
    const path = `users/${c.uid}/${folder}/${String(a.id)}.${ext}`;
    await setDoc(doc(fs, 'assets', String(a.id)), toCreatePayload('assets', { ...a, type, cloudPath: path, size: 8 }));
    await uploadBytes(ref(c.storage, path), new Uint8Array(8).fill(1), { contentType });
  }
}

/** Counts a user's remaining docs and files with rules disabled (the "auditor" view). */
async function remaining(uid: string): Promise<{ docs: number; files: number; profile: boolean }> {
  let docs = 0;
  let files = 0;
  let profile = false;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    for (const name of COLLECTION_NAMES) {
      docs += (await getDocs(query(collection(fs, name), where('owner', '==', uid)))).size;
    }
    profile = (await getDocs(query(collection(fs, 'users'), where('id', '==', uid)))).size > 0;
    const st = ctx.storage(BUCKET);
    for (const folder of Object.keys(STORAGE)) {
      files += (await listAll(ref(st, `users/${uid}/${folder}`))).items.length;
    }
  });
  return { docs, files, profile };
}

describe('deleteAccount', () => {
  it('deletes every doc, every file, the profile and the Auth user; leaves Bob alone', async () => {
    const alice = await createRealClient(nextEmail());
    await seedFullAccount(alice);
    // Bob's data, seeded with rules off.
    await seedUser(env, BOB);
    const bobNote = validDoc('notes', BOB);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'notes', String(bobNote.id)), bobNote);
    });

    const before = await remaining(alice.uid);
    expect(before.docs).toBe(3 * (COLLECTION_NAMES.length - 1) + 4);
    expect(before.files).toBe(4);
    expect(before.profile).toBe(true);

    const report = await deleteAccount(alice, { pageSize: 2 }); // tiny pages exercise paging
    expect(report.storageFilesDeleted).toBe(4);
    expect(Object.values(report.docsDeleted).reduce((a, b) => a + b, 0)).toBe(before.docs);
    expect(report.profileDeleted).toBe(true);

    expect(await remaining(alice.uid)).toEqual({ docs: 0, files: 0, profile: false });
    expect(await authUserExists(alice.uid)).toBe(false);
    // Bob untouched.
    expect((await remaining(BOB)).docs).toBe(1);
    await alice.close();
  });

  it('resumes after a crash mid-way and still deletes everything', async () => {
    const alice = await createRealClient(nextEmail());
    await seedFullAccount(alice);

    // Simulate the app dying after the first Firestore batch.
    let batches = 0;
    await expect(
      deleteAccount(alice, {
        pageSize: 2,
        onProgress: (p) => {
          if (p.step === 'firestore' && ++batches === 1) throw new Error('simulated crash');
        },
      }),
    ).rejects.toThrow('simulated crash');

    const mid = await remaining(alice.uid);
    expect(mid.profile).toBe(true); // still marked, not finished
    expect(mid.files).toBe(0); // storage step already done
    expect(mid.docs).toBeGreaterThan(0);

    await deleteAccount(alice, { pageSize: 2 }); // second run resumes
    expect(await remaining(alice.uid)).toEqual({ docs: 0, files: 0, profile: false });
    expect(await authUserExists(alice.uid)).toBe(false);
    await alice.close();
  });

  it('a user who never synced (no profile) just has the Auth account deleted', async () => {
    const carol = await createRealClient(nextEmail());
    const report = await deleteAccount(carol);
    expect(report.profileDeleted).toBe(false);
    expect(await authUserExists(carol.uid)).toBe(false);
    await carol.close();
  });

  it('an unverified user (who cannot have cloud data) is deleted from Auth', async () => {
    const dave = await createRealClient(nextEmail(), { verified: false });
    await deleteAccount(dave);
    expect(await authUserExists(dave.uid)).toBe(false);
    await dave.close();
  });

  it('throws NotSignedInError when nobody is signed in', async () => {
    const fake = { auth: { currentUser: null }, firestore: {}, storage: {} } as unknown as Parameters<typeof deleteAccount>[0];
    await expect(deleteAccount(fake)).rejects.toBeInstanceOf(NotSignedInError);
  });

  it('maps auth/requires-recent-login to ReauthRequiredError', async () => {
    const user = {
      uid: 'u1',
      emailVerified: false,
      delete: () => Promise.reject(Object.assign(new Error('recent login'), { code: 'auth/requires-recent-login' })),
    };
    const fake = { auth: { currentUser: user }, firestore: {}, storage: {} } as unknown as Parameters<typeof deleteAccount>[0];
    await expect(deleteAccount(fake)).rejects.toBeInstanceOf(ReauthRequiredError);
  });
});
