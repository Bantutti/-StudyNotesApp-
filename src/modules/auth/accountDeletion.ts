/**
 * In-app account deletion (both stores; P2a ACCOUNT_DELETION §A.2.1).
 *
 * Order:
 *   1. The UI has the person re-sign-in first (Firebase requires a recent
 *      sign-in; Apple also hands out the authorization code we need next).
 *   2. Sign in with Apple: revoke Apple's tokens (Apple's rule for apps with
 *      Sign in with Apple; C1). If that fails, deletion continues and the
 *      person is told how to remove the app in their Apple ID settings.
 *   3. Stop sync (P2a precondition).
 *   4. P2a's deleteAccount(): mark, Storage, Firestore (resumable), profile,
 *      Auth user. ReauthRequiredError -> "sign in again", then run again
 *      (finished steps are no-ops).
 *   5. This phone: the notes stay as guest notes (resetToGuest); the screen
 *      then offers "Delete the notes on this phone too".
 * Progress events carry step names and counts only.
 */
import { revokeAccessToken, type Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';

import type { Logger } from '@/core';
import type { Store } from '@/modules/store';

import { AuthError } from './authService';
import { deleteAccount as p2aDeleteAccount, ReauthRequiredError, type DeletionProgress, type DeletionReport } from './p2aDeletion';

export interface AccountDeletionDeps {
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
  logger: Logger;
  /** Stops the sync engine (and its scheduler) before anything is deleted. */
  stopSync: () => Promise<void>;
  /** Overridable for tests (the emulator has no Apple revoke endpoint). */
  revokeApple?: (auth: Auth, code: string) => Promise<void>;
  deleteAccount?: typeof p2aDeleteAccount;
}

export interface AccountDeletionResult {
  report: DeletionReport;
  /** 'not_apple' | 'revoked' | 'failed' (show the Apple ID settings hint) | 'no_code' */
  appleRevoke: 'not_apple' | 'revoked' | 'failed' | 'no_code';
}

export async function deleteAccountAndCloudData(
  deps: AccountDeletionDeps,
  store: Pick<Store, 'sync'>,
  opts: { appleAuthorizationCode: string | null; onProgress?: (p: DeletionProgress) => void },
): Promise<AccountDeletionResult> {
  const log = deps.logger.child('account_deletion');
  const user = deps.auth.currentUser;
  if (!user) throw new AuthError('reauth_required', 'Sign in again to delete your account.');
  const isApple = user.providerData.some((p) => p.providerId === 'apple.com');

  let appleRevoke: AccountDeletionResult['appleRevoke'] = 'not_apple';
  if (isApple) {
    if (!opts.appleAuthorizationCode) appleRevoke = 'no_code';
    else {
      try {
        await (deps.revokeApple ?? revokeAccessToken)(deps.auth, opts.appleAuthorizationCode);
        appleRevoke = 'revoked';
      } catch {
        appleRevoke = 'failed';
        log.warn('apple_revoke_failed');
      }
    }
  }

  await deps.stopSync();
  let report: DeletionReport;
  try {
    report = await (deps.deleteAccount ?? p2aDeleteAccount)(
      { auth: deps.auth, firestore: deps.firestore, storage: deps.storage },
      { onProgress: (p) => opts.onProgress?.(p) },
    );
  } catch (e) {
    if (e instanceof ReauthRequiredError) throw new AuthError('reauth_required', 'Your notes are already deleted from the cloud. Sign in again to finish deleting your account.');
    log.warn('failed', { name: e instanceof Error ? e.name : 'unknown' });
    throw e;
  }
  await store.sync.resetToGuest();
  log.info('done', { files: report.storageFilesDeleted });
  return { report, appleRevoke };
}
