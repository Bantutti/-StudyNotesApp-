/**
 * realClient.ts — a REAL Firebase JS SDK client wired to the emulators, with a
 * REAL Auth emulator user (not a fake token). Used to test the deletion module
 * end to end, through the security rules, exactly as the app will call it.
 */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { PROJECT_ID } from './env.js';

export const BUCKET = `${PROJECT_ID}.appspot.com`;

function hostPort(envVar: string, fallback: string): { host: string; port: number } {
  const raw = process.env[envVar] ?? fallback;
  const i = raw.lastIndexOf(':');
  return { host: raw.slice(0, i), port: Number(raw.slice(i + 1)) };
}

export const AUTH_EMULATOR = hostPort('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');

export interface RealClient {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
  uid: string;
  close(): Promise<void>;
}

let appCounter = 0;

/** Calls an Auth emulator admin endpoint ("Bearer owner" is the emulator's admin token). */
export async function authEmulatorAdmin(path: string, body: unknown): Promise<unknown> {
  const url = `http://${AUTH_EMULATOR.host}:${AUTH_EMULATOR.port}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/${path}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Auth emulator ${path} failed: ${res.status}`);
  return res.json();
}

/** True when the Auth emulator still has an account with this uid. */
export async function authUserExists(uid: string): Promise<boolean> {
  const r = (await authEmulatorAdmin('accounts:lookup', { localId: [uid] })) as { users?: unknown[] };
  return Array.isArray(r.users) && r.users.length > 0;
}

/** Creates a fresh app + Auth user, optionally marks the email verified, and signs in. */
export async function createRealClient(email: string, opts: { verified?: boolean } = {}): Promise<RealClient> {
  appCounter += 1;
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-api-key', storageBucket: BUCKET }, `client-${appCounter}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_EMULATOR.host}:${AUTH_EMULATOR.port}`, { disableWarnings: true });
  const firestore = initializeFirestore(app, {});
  const fsHp = hostPort('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
  connectFirestoreEmulator(firestore, fsHp.host, fsHp.port);
  const storage = getStorage(app);
  const stHp = hostPort('FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9199');
  connectStorageEmulator(storage, stHp.host, stHp.port);

  const cred = await createUserWithEmailAndPassword(auth, email, 'test-password-123');
  if (opts.verified ?? true) {
    await authEmulatorAdmin('accounts:update', { localId: cred.user.uid, emailVerified: true });
    await cred.user.reload();
    await cred.user.getIdToken(true); // refresh so the token carries email_verified = true
  }
  return { app, auth, firestore, storage, uid: cred.user.uid, close: () => deleteApp(app) };
}
