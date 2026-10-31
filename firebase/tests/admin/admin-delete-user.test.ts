/**
 * admin-delete-user.test.ts — the operator script for web deletion requests.
 * Checks argument safety, the emulator/production guard, dry run vs delete,
 * and that the script's collection list never drifts from the schemas.
 * Also runs the real CLI with `node` once, as Rey would.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { listAll, ref, uploadBytes } from 'firebase/storage';
import { ADMIN_COLLECTIONS, checkEnvironment, parseArgs, run } from '../../scripts/admin-delete-user.js';
import { COLLECTION_NAMES } from '../../src/schemas/collections.js';
import { BOB, createEnv, PROJECT_ID, seedUser } from '../helpers/env.js';
import { validDoc } from '../helpers/fixtures.js';
import { authUserExists, BUCKET, createRealClient } from '../helpers/realClient.js';

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
});

/** Seeds a user's profile, one doc per collection and one file (rules off). */
async function seedAccount(uid: string): Promise<void> {
  await seedUser(env, uid);
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const name of COLLECTION_NAMES) {
      const d = validDoc(name, uid);
      await setDoc(doc(ctx.firestore(), name, String(d.id)), d);
    }
    await uploadBytes(ref(ctx.storage(BUCKET), `users/${uid}/images/file0000000000000001.png`), new Uint8Array(4), { contentType: 'image/png' });
  });
}

async function docCount(uid: string): Promise<number> {
  let n = 0;
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const name of COLLECTION_NAMES) n += (await getDocs(query(collection(ctx.firestore(), name), where('owner', '==', uid)))).size;
  });
  return n;
}

describe('safety checks (no emulator needed)', () => {
  it('ADMIN_COLLECTIONS matches the schema registry exactly', () => {
    expect([...ADMIN_COLLECTIONS]).toEqual(COLLECTION_NAMES);
  });

  it('rejects unknown flags and missing required flags', () => {
    expect(() => parseArgs(['--project', 'p', '--uid', 'u', '--force', 'yes'])).toThrow();
    expect(() => parseArgs(['--uid', 'u'])).toThrow('--project');
    expect(() => parseArgs(['--project', 'p'])).toThrow('--uid or --email');
  });

  it('refuses real projects on emulators and demo projects without emulators', () => {
    expect(() => {
      checkEnvironment('studynotes-prod', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
    }).toThrow();
    expect(() => {
      checkEnvironment('demo-studynotes', {});
    }).toThrow();
    expect(() => {
      checkEnvironment('demo-studynotes', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
    }).not.toThrow();
  });
});

describe('against the emulators', () => {
  it('dry run changes nothing; --confirm <uid> deletes everything for that uid only', async () => {
    const alice = await createRealClient(`admin-${Date.now()}@example.test`);
    await seedAccount(alice.uid);
    await seedAccount(BOB);

    const dry = await run({ project: PROJECT_ID, uid: alice.uid });
    expect(dry.dryRun).toBe(true);
    expect(dry.files).toBe(1);
    expect(await docCount(alice.uid)).toBe(COLLECTION_NAMES.length);

    await expect(run({ project: PROJECT_ID, uid: alice.uid, confirm: 'wrong-uid' })).rejects.toThrow('--confirm');

    const done = await run({ project: PROJECT_ID, uid: alice.uid, confirm: alice.uid });
    expect(done.dryRun).toBe(false);
    expect(await docCount(alice.uid)).toBe(0);
    expect(await authUserExists(alice.uid)).toBe(false);
    let filesLeft = -1;
    await env.withSecurityRulesDisabled(async (ctx) => {
      filesLeft = (await listAll(ref(ctx.storage(BUCKET), `users/${alice.uid}/images`))).items.length;
    });
    expect(filesLeft).toBe(0);
    expect(await docCount(BOB)).toBe(COLLECTION_NAMES.length); // Bob untouched
    await alice.close();
  });

  it('the CLI runs with plain `node` (type stripping) and looks up by email', async () => {
    const email = `cli-${Date.now()}@example.test`;
    const carol = await createRealClient(email);
    await seedAccount(carol.uid);
    const script = fileURLToPath(new URL('../../scripts/admin-delete-user.ts', import.meta.url));
    const out = execFileSync(process.execPath, [script, '--project', PROJECT_ID, '--email', email], { env: process.env, encoding: 'utf8' });
    expect(out).toContain('DRY RUN');
    expect(out).toContain(`uid: ${carol.uid}`);
    expect(out).not.toContain(email); // never echoes the email
    await carol.close();
  });
});
