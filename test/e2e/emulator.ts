/**
 * Emulator helpers for the e2e suites (never bundled into the app).
 * - Accounts are created with the real SDK; email verification uses the
 *   Auth emulator's oobCodes endpoint (the same way a person clicks the
 *   link in the email).
 * - Everything is wiped between tests through the emulators' REST APIs.
 */
import { createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword, type Auth } from 'firebase/auth';

import { createCloudServices, type CloudConfig, type CloudServices } from '../../src/modules/cloud';

export const PROJECT = 'demo-studynotes';
export const HOST = '127.0.0.1';
export const CONFIG: CloudConfig = {
  projectId: PROJECT,
  apiKey: 'demo-api-key',
  storageBucket: `${PROJECT}.appspot.com`,
  emulator: { host: HOST, authPort: 9099, firestorePort: 8080, storagePort: 9199 },
};
const AUTH = `http://${HOST}:9099`;
const FIRESTORE = `http://${HOST}:8080`;
const STORAGE = `http://${HOST}:9199`;

let n = 0;
export function cloudFor(name: string): CloudServices {
  return createCloudServices(CONFIG, { name: `${name}-${++n}`, forceLongPolling: false });
}

/** Clears Auth users, Firestore docs and Storage files. */
export async function resetEmulators(): Promise<void> {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const list = (await (await fetch(`${STORAGE}/v0/b/${CONFIG.storageBucket}/o?maxResults=1000`, { headers: { Authorization: 'Bearer owner' } })).json()) as { items?: { name: string }[] };
  for (const it of list.items ?? []) {
    await fetch(`${STORAGE}/v0/b/${CONFIG.storageBucket}/o/${encodeURIComponent(it.name)}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  }
}

/** Opens every verification link the Auth emulator has "sent" for `email`. */
export async function clickVerificationLinks(email: string): Promise<number> {
  const r = (await (await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json()) as { oobCodes: { email: string; requestType: string; oobLink: string }[] };
  const links = r.oobCodes.filter((c) => c.email === email && c.requestType === 'VERIFY_EMAIL');
  for (const l of links) await fetch(l.oobLink);
  return links.length;
}

/** A new account with a verified email, signed in on `auth`. Returns the uid. */
export async function createVerifiedUser(auth: Auth, email: string, password = 'correct horse battery 9'): Promise<string> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(cred.user);
  await clickVerificationLinks(email);
  await cred.user.reload();
  await cred.user.getIdToken(true); // the rules read email_verified from the token
  return cred.user.uid;
}

export async function signIn(auth: Auth, email: string, password = 'correct horse battery 9'): Promise<string> {
  const c = await signInWithEmailAndPassword(auth, email, password);
  await c.user.getIdToken(true);
  return c.user.uid;
}

/** Number of documents of every collection, read as the admin (Bearer owner). */
export async function countAllDocs(): Promise<number> {
  let total = 0;
  for (const c of ['users', 'subjects', 'folders', 'notes', 'cards', 'reviewLogs', 'recordings', 'assets', 'stylePacks', 'templates']) {
    const r = (await (await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${c}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } })).json()) as { documents?: unknown[] };
    total += r.documents?.length ?? 0;
  }
  return total;
}

export async function countStorageFiles(): Promise<number> {
  const list = (await (await fetch(`${STORAGE}/v0/b/${CONFIG.storageBucket}/o?maxResults=1000`, { headers: { Authorization: 'Bearer owner' } })).json()) as { items?: unknown[] };
  return list.items?.length ?? 0;
}

export async function countAuthUsers(): Promise<number> {
  const r = (await (
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnUserInfo: false }),
    })
  ).json()) as { recordsCount?: string };
  return Number(r.recordsCount ?? 0);
}
