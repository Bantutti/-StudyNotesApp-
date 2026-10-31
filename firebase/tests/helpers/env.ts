/**
 * env.ts — shared emulator test environment (rules-unit-testing).
 * Runs only inside `firebase emulators:exec` (npm test), which sets the
 * FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST variables.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, type RulesTestEnvironment, type RulesTestContext } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

export const PROJECT_ID = 'demo-studynotes';

/** Two users with realistic 28-char uids, plus helpers for unverified / anonymous callers. */
export const ALICE = 'aliceUid00000000000000000001';
export const BOB = 'bobUid0000000000000000000002';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Splits "host:port" from an emulator env var (set by emulators:exec). */
function hostPort(envVar: string, fallbackPort: number): { host: string; port: number } {
  const raw = process.env[envVar];
  if (!raw) return { host: '127.0.0.1', port: fallbackPort };
  const i = raw.lastIndexOf(':');
  return { host: raw.slice(0, i), port: Number(raw.slice(i + 1)) };
}

export async function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...hostPort('FIRESTORE_EMULATOR_HOST', 8080), rules: readFileSync(`${root}firestore.rules`, 'utf8') },
    storage: { ...hostPort('FIREBASE_STORAGE_EMULATOR_HOST', 9199), rules: readFileSync(`${root}storage.rules`, 'utf8') },
  });
}

/** Signed-in, email-verified user (the only kind the rules accept). */
export function verifiedCtx(env: RulesTestEnvironment, uid: string): RulesTestContext {
  return env.authenticatedContext(uid, { email_verified: true });
}

/** Signed in, but the email link was never clicked. */
export function unverifiedCtx(env: RulesTestEnvironment, uid: string): RulesTestContext {
  return env.authenticatedContext(uid, { email_verified: false });
}

/** Writes a valid, active users/{uid} profile with rules disabled (test setup only). */
export async function seedUser(env: RulesTestEnvironment, uid: string, extra: Record<string, unknown> = {}): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const now = Timestamp.now();
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      id: uid,
      owner: uid,
      schemaVersion: 1,
      created: now,
      updated: now,
      rev: 1,
      settings: '{}',
      deletionRequestedAt: null,
      ...extra,
    });
  });
}
