/**
 * deleteAccount.ts — in-app account deletion, no Cloud Functions (decision 2).
 *
 * Required by both stores: Apple (in-app deletion) and Google Play (in-app AND
 * a web request path; the web path is scripts/admin-delete-user.ts).
 *
 * ORDER (docs/backend/ACCOUNT_DELETION.md §A.2) — every step is idempotent, so
 * if the app crashes or loses network, calling deleteAccount() again resumes:
 *   1. mark      users/{uid}.deletionRequestedAt = serverTime
 *                -> rules now refuse every new write/upload from ANY device,
 *                   and allow hard-deleting live docs and review logs.
 *   2. storage   list + delete users/{uid}/{audio,images,ink,attachments}/*
 *   3. firestore for each collection (reviewLogs first): query owner == uid,
 *                limit pageSize, batch-delete, repeat until empty
 *   4. profile   delete users/{uid} (last: it is the "deletion in progress" flag)
 *   5. auth      user.delete(); needs a recent sign-in -> ReauthRequiredError,
 *                the UI re-authenticates and calls deleteAccount() again
 *                (steps 1–4 are then no-ops and only step 5 runs).
 *
 * PRECONDITIONS for the caller (P2 app side):
 *   - online (reads use getDocsFromServer so an empty cache is never mistaken
 *     for "nothing left"); stop the sync engine first
 *   - the user confirmed in the UI; this function does not ask again
 *
 * NEVER logs note content or personal data (rule 1). Progress events carry
 * only step names and counts.
 */
import type { Auth, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { deleteObject, list, ref, type FirebaseStorage } from 'firebase/storage';
import { COLLECTION_NAMES, type CollectionName } from '../schemas/collections.js';
import { QUERY_LIMIT_MAX, STORAGE, type StorageFolder } from '../schemas/limits.js';

export interface DeletionDeps {
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
}

export type DeletionStep = 'mark' | 'storage' | 'firestore' | 'profile' | 'auth';

/** Content-free progress event: step + counts only. */
export interface DeletionProgress {
  step: DeletionStep;
  /** Collection or Storage folder being processed, when relevant. */
  scope?: string;
  /** Items deleted so far within this scope. */
  deleted: number;
}

export interface DeletionOptions {
  /** Docs per query/batch (1..500; rules cap queries at 500). Default 200. */
  pageSize?: number;
  /** Called after each step/batch. Throwing from it aborts (used by resume tests). */
  onProgress?: (p: DeletionProgress) => void;
}

export interface DeletionReport {
  storageFilesDeleted: number;
  docsDeleted: Record<CollectionName, number>;
  profileDeleted: boolean;
  authUserDeleted: true;
}

/** No signed-in user: nothing to delete from this device. */
export class NotSignedInError extends Error {
  override name = 'NotSignedInError';
}

/** Data is gone, but Auth needs a fresh sign-in before the account itself can be removed. */
export class ReauthRequiredError extends Error {
  override name = 'ReauthRequiredError';
}

const STORAGE_FOLDERS = Object.keys(STORAGE) as StorageFolder[];
const MAX_MARK_ATTEMPTS = 3;

/** Firebase errors carry a string `code`; this reads it without trusting the shape. */
function errorCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** Clamp the page size into the range the rules accept (§L.9). */
function clampPageSize(n: number | undefined): number {
  const v = n ?? 200;
  return Math.min(Math.max(Math.trunc(v), 1), QUERY_LIMIT_MAX);
}

/**
 * Step 1 — mark the profile. Returns false when there is no profile, which
 * means either the user never synced or a previous run already finished
 * steps 2–4 (writes require a profile, so no profile => no cloud data).
 */
async function markDeletion(fs: Firestore, uid: string): Promise<boolean> {
  const userRef = doc(fs, 'users', uid);
  for (let attempt = 1; attempt <= MAX_MARK_ATTEMPTS; attempt++) {
    const snap = await getDocFromServer(userRef);
    if (!snap.exists()) return false;
    const data = snap.data() as { rev?: unknown; deletionRequestedAt?: unknown };
    if (data.deletionRequestedAt != null) return true; // resumed run: already marked
    if (typeof data.rev !== 'number') throw new Error('Profile has no numeric rev; cannot mark deletion');
    try {
      // rev + 1: if another device bumped rev in between, the rules reject this
      // update and we simply re-read and retry.
      await updateDoc(userRef, { deletionRequestedAt: serverTimestamp(), updated: serverTimestamp(), rev: data.rev + 1 });
      return true;
    } catch (e) {
      if (errorCode(e) !== 'permission-denied' || attempt === MAX_MARK_ATTEMPTS) throw e;
    }
  }
  return true; // unreachable; loop either returns or throws
}

/** Step 2 — delete every file under users/{uid}/{folder}/, page by page. */
async function deleteStorage(st: FirebaseStorage, uid: string, pageSize: number, report: DeletionReport, onProgress?: DeletionOptions['onProgress']): Promise<void> {
  for (const folder of STORAGE_FOLDERS) {
    let deleted = 0;
    // Always list from the start: items deleted on the previous page are gone,
    // so a fresh first page is the next batch (no stale page tokens).
    for (;;) {
      const page = await list(ref(st, `users/${uid}/${folder}`), { maxResults: pageSize });
      if (page.items.length === 0) break;
      await Promise.all(
        page.items.map(async (item) => {
          try {
            await deleteObject(item);
          } catch (e) {
            if (errorCode(e) !== 'storage/object-not-found') throw e; // already gone = fine
          }
        }),
      );
      deleted += page.items.length;
      report.storageFilesDeleted += page.items.length;
      onProgress?.({ step: 'storage', scope: folder, deleted });
    }
  }
}

/** Step 3 — batch-delete the user's docs in one collection until none are left. */
async function deleteCollection(fs: Firestore, uid: string, name: CollectionName, pageSize: number, report: DeletionReport, onProgress?: DeletionOptions['onProgress']): Promise<void> {
  for (;;) {
    // owner filter + limit are REQUIRED by the rules (canList()).
    const snap = await getDocsFromServer(query(collection(fs, name), where('owner', '==', uid), limit(pageSize)));
    if (snap.empty) return;
    const batch = writeBatch(fs);
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    report.docsDeleted[name] += snap.size;
    onProgress?.({ step: 'firestore', scope: name, deleted: report.docsDeleted[name] });
  }
}

/** Step 5 — delete the Auth account; maps "needs recent login" to ReauthRequiredError. */
async function deleteAuthUser(user: User): Promise<void> {
  try {
    await user.delete();
  } catch (e) {
    if (errorCode(e) === 'auth/requires-recent-login') {
      throw new ReauthRequiredError('Sign in again to finish deleting your account. Your notes are already deleted.');
    }
    throw e;
  }
}

/**
 * Deletes ALL of the signed-in user's cloud data, then the Auth account.
 * Safe to call repeatedly; each call resumes where the last one stopped.
 */
export async function deleteAccount(deps: DeletionDeps, options: DeletionOptions = {}): Promise<DeletionReport> {
  const user = deps.auth.currentUser;
  if (!user) throw new NotSignedInError('No signed-in user');
  const uid = user.uid;
  const pageSize = clampPageSize(options.pageSize);
  const { onProgress } = options;

  const report: DeletionReport = {
    storageFilesDeleted: 0,
    docsDeleted: Object.fromEntries(COLLECTION_NAMES.map((c) => [c, 0])) as Record<CollectionName, number>,
    profileDeleted: false,
    authUserDeleted: true,
  };

  // Unverified users can't have cloud data (rules require email_verified for
  // every read and write), so they go straight to step 5.
  if (user.emailVerified) {
    const hasProfile = await markDeletion(deps.firestore, uid);
    onProgress?.({ step: 'mark', deleted: 0 });

    if (hasProfile) {
      await deleteStorage(deps.storage, uid, pageSize, report, onProgress);
      for (const name of COLLECTION_NAMES) {
        await deleteCollection(deps.firestore, uid, name, pageSize, report, onProgress);
      }
      await deleteDoc(doc(deps.firestore, 'users', uid));
      report.profileDeleted = true;
      onProgress?.({ step: 'profile', deleted: 1 });
    }
  }

  await deleteAuthUser(user);
  onProgress?.({ step: 'auth', deleted: 1 });
  return report;
}
