/**
 * One account per local database (decision Q7).
 *
 * - First sign-in binds the database to the uid; guest data then uploads.
 * - Signing out keeps the notes on the phone, still bound to that account.
 * - Signing in with a DIFFERENT account is refused until the person chooses
 *   "Remove notes from this phone" (P1's Delete all data), so one person's
 *   notes can never upload into another account (plan §17 threat).
 */
import type { Store } from '@/modules/store';

export type BindResult = { ok: true; firstTime: boolean } | { ok: false; reason: 'other_account' };

export async function bindAccount(store: Pick<Store, 'sync'>, uid: string): Promise<BindResult> {
  const st = await store.sync.getState();
  if (st.uid !== null && st.uid !== uid) return { ok: false, reason: 'other_account' };
  if (st.uid === uid) return { ok: true, firstTime: false };
  await store.sync.bind(uid);
  return { ok: true, firstTime: true };
}

/** Sign-out: sync stops; data and binding stay (Q7). */
export async function pauseSyncForSignOut(store: Pick<Store, 'sync'>): Promise<void> {
  await store.sync.setEnabled(false);
}
