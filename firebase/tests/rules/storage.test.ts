/**
 * storage.test.ts — Cloud Storage rules: owner-only, per-folder content types
 * and size caps, and the Firestore asset-doc cross-check (every byte tracked).
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getBytes, listAll, ref, uploadBytes } from 'firebase/storage';
import { ALICE, BOB, createEnv, seedUser, unverifiedCtx, verifiedCtx } from '../helpers/env.js';
import { newId } from '../helpers/fixtures.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seedUser(env, ALICE);
  await seedUser(env, BOB);
});

const EXT = { audio: 'm4a', image: 'png', sticker: 'png', ink: 'json', pdf: 'pdf' } as const;
const FOLDER = { audio: 'audio', image: 'images', sticker: 'images', ink: 'ink', pdf: 'attachments' } as const;
type AssetType = keyof typeof EXT;

/** Seeds an asset doc (rules off) and returns its storage path. */
async function seedAsset(uid: string, type: AssetType, size: number, overrides: Record<string, unknown> = {}): Promise<{ id: string; path: string }> {
  const id = newId('as');
  const path = `users/${uid}/${FOLDER[type]}/${id}.${EXT[type]}`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const now = Timestamp.now();
    await setDoc(doc(ctx.firestore(), 'assets', id), {
      id, owner: uid, schemaVersion: 1, created: now, updated: now, rev: 1, deleted: false, type, cloudPath: path, size, ...overrides,
    });
  });
  return { id, path };
}

const bytes = (n: number) => new Uint8Array(n).fill(7);
const storage = (uid = ALICE) => verifiedCtx(env, uid).storage();

describe('uploads', () => {
  it('owner can upload when a matching asset doc exists (audio, image, ink, pdf)', async () => {
    const cases: Array<[AssetType, string]> = [['audio', 'audio/mp4'], ['image', 'image/png'], ['ink', 'application/json'], ['pdf', 'application/pdf']];
    for (const [type, contentType] of cases) {
      const { path } = await seedAsset(ALICE, type, 16);
      await assertSucceeds(uploadBytes(ref(storage(), path), bytes(16), { contentType }));
    }
  });

  it('denied without an asset doc (untracked files are not allowed)', async () => {
    const path = `users/${ALICE}/images/${newId('as')}.png`;
    await assertFails(uploadBytes(ref(storage(), path), bytes(16), { contentType: 'image/png' }));
  });

  it("denied when the byte size differs from the asset doc's size", async () => {
    const { path } = await seedAsset(ALICE, 'image', 16);
    await assertFails(uploadBytes(ref(storage(), path), bytes(17), { contentType: 'image/png' }));
  });

  it('denied for a wrong content type (e.g. HTML disguised in the images folder)', async () => {
    const { path } = await seedAsset(ALICE, 'image', 16);
    await assertFails(uploadBytes(ref(storage(), path), bytes(16), { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(storage(), path), bytes(16), { contentType: 'image/svg+xml' }));
  });

  it('denied over the folder cap (5 MiB images)', async () => {
    const { path } = await seedAsset(ALICE, 'image', 5 * 1024 * 1024 + 1);
    await assertFails(uploadBytes(ref(storage(), path), bytes(5 * 1024 * 1024 + 1), { contentType: 'image/png' }));
  });

  it('denied for empty files, custom metadata, bad names and unknown folders', async () => {
    const { path } = await seedAsset(ALICE, 'image', 16);
    await assertFails(uploadBytes(ref(storage(), path), bytes(0), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(storage(), path), bytes(16), { contentType: 'image/png', customMetadata: { note: 'secret' } }));
    await assertFails(uploadBytes(ref(storage(), `users/${ALICE}/images/../evil.png`), bytes(16), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(storage(), `users/${ALICE}/images/short.png`), bytes(16), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(storage(), `users/${ALICE}/scripts/${newId('as')}.png`), bytes(16), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(storage(), `public/${newId('as')}.png`), bytes(16), { contentType: 'image/png' }));
  });

  it('denied when the asset doc is tombstoned, owned by someone else, or of another type', async () => {
    const tomb = await seedAsset(ALICE, 'image', 16, { deleted: true });
    await assertFails(uploadBytes(ref(storage(), tomb.path), bytes(16), { contentType: 'image/png' }));

    // Asset doc says audio, upload goes to images with the same id.
    const audio = await seedAsset(ALICE, 'audio', 16);
    await assertFails(uploadBytes(ref(storage(), `users/${ALICE}/images/${audio.id}.png`), bytes(16), { contentType: 'image/png' }));

    // Bob's asset doc pointing into Alice's folder doesn't help Alice or Bob.
    const bobs = await seedAsset(BOB, 'image', 16);
    await assertFails(uploadBytes(ref(storage(), `users/${ALICE}/images/${bobs.id}.png`), bytes(16), { contentType: 'image/png' }));
  });

  it("Bob cannot upload into Alice's folder", async () => {
    const { path } = await seedAsset(ALICE, 'image', 16);
    await assertFails(uploadBytes(ref(storage(BOB), path), bytes(16), { contentType: 'image/png' }));
  });

  it('unverified and signed-out callers cannot upload', async () => {
    const { path } = await seedAsset(ALICE, 'image', 16);
    await assertFails(uploadBytes(ref(unverifiedCtx(env, ALICE).storage(), path), bytes(16), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), path), bytes(16), { contentType: 'image/png' }));
  });

  it('uploads are denied once account deletion has started', async () => {
    const { path } = await seedAsset(ALICE, 'image', 16);
    await assertSucceeds(
      updateDoc(doc(verifiedCtx(env, ALICE).firestore(), 'users', ALICE), { deletionRequestedAt: serverTimestamp(), updated: serverTimestamp(), rev: 2 }),
    );
    await assertFails(uploadBytes(ref(storage(), path), bytes(16), { contentType: 'image/png' }));
  });

  it('overwriting the ink layer works after the asset size is updated', async () => {
    const { id, path } = await seedAsset(ALICE, 'ink', 16);
    await assertSucceeds(uploadBytes(ref(storage(), path), bytes(16), { contentType: 'application/json' }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'assets', id), { size: 32, rev: 2 });
    });
    await assertSucceeds(uploadBytes(ref(storage(), path), bytes(32), { contentType: 'application/json' }));
  });
});

describe('reads, lists, deletes', () => {
  async function seedFile(uid: string): Promise<string> {
    const { path } = await seedAsset(uid, 'image', 16);
    await uploadBytes(ref(storage(uid), path), bytes(16), { contentType: 'image/png' });
    return path;
  }

  it('owner can read; Bob and signed-out callers cannot', async () => {
    const path = await seedFile(ALICE);
    await assertSucceeds(getBytes(ref(storage(), path)));
    await assertFails(getBytes(ref(storage(BOB), path)));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), path)));
  });

  it('owner can list their own folder; Bob cannot list it', async () => {
    await seedFile(ALICE);
    await assertSucceeds(listAll(ref(storage(), `users/${ALICE}/images`)));
    await assertFails(listAll(ref(storage(BOB), `users/${ALICE}/images`)));
  });

  it('owner can delete (even with the asset doc gone); Bob cannot', async () => {
    const path = await seedFile(ALICE);
    await assertFails(deleteObject(ref(storage(BOB), path)));
    await env.clearFirestore(); // asset doc gone, as at the end of account deletion
    await assertSucceeds(deleteObject(ref(storage(), path)));
  });
});
