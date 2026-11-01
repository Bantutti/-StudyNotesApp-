# Account deletion (P2a)

Sections are **§A.x**.

## §A.1 What the stores require

- **Apple:** an app that lets people create an account must let them start account deletion **inside the app**.
- **Google Play:** account deletion **inside the app AND through a web link** where people can ask for deletion without reinstalling the app. All the account's data must be deleted; freezing the account doesn't count. The link goes in Play Console's Data safety form. Source: support.google.com/googleplay/android-developer/answer/13327111.

Decision (Rey, Nov 1 2026): **in the app, free, no Cloud Functions.** The web requests are handled by Rey with an admin script.

## §A.2 In-app flow: `firebase/src/deletion`

```ts
import { deleteAccount, ReauthRequiredError } from '<path>/firebase/src/deletion';
await deleteAccount({ auth, firestore, storage }, { onProgress });
```

| Step | What happens | Why this order |
|---|---|---|
| 1. mark | `users/{uid}.deletionRequestedAt = serverTimestamp()` (rev + 1, retried on a rev conflict) | From now on the rules refuse new writes and uploads from **any** device, so a second phone can't re-upload while we delete |
| 2. storage | list and delete every file in `users/{uid}/audio, images, ink, attachments` | Storage deletes don't depend on asset docs, so this can run first |
| 3. firestore | for each collection, reviewLogs first: query `owner == uid` with `limit(pageSize)`, batch-delete, repeat until empty | Logs go first because their delete rule may read cards; `getDocsFromServer` so an empty cache is never mistaken for "done" |
| 4. profile | delete `users/{uid}` | Last, because it is the "deletion in progress" flag; once it's gone, writes are impossible |
| 5. auth | `user.delete()` | Firebase requires a recent sign-in, which is mapped to `ReauthRequiredError` |

**Resuming.** Every step can safely run again. If the app crashes, goes offline or gets killed, calling `deleteAccount()` again continues where it stopped (this is proven in `tests/deletion`). After a `ReauthRequiredError`, the UI asks the user to sign in again and calls it once more. Steps 1 to 4 find nothing left, and step 5 runs.

**Unverified users** can't have cloud data (the rules require a verified email), so they skip straight to step 5.

### §A.2.1 What the P2 app side must do

1. A confirm screen: "Delete your account and all synced notes, cards, recordings and files? This can't be undone. Notes on this device stay unless you also choose Delete local data."
2. **Stop the sync engine** before calling `deleteAccount` (an online connection is required).
3. Show progress from `onProgress` (step names and counts only; it never contains note content).
4. Handle `ReauthRequiredError` by asking for sign-in again, then calling it again.
5. Don't offer "cancel" once step 2 has started. Clearing `deletionRequestedAt` is possible, but the data deleted so far is already gone.
6. After success: sign out, clear the local sync state, and offer to delete local data too (plan: "delete all data").

## §A.3 Why not Cloud Functions

A function (or the "Delete User Data" extension) is the most robust option, because it can run even if the app never comes back. But it needs the **Blaze plan** (a billing account) and function deploys. Within the free tier it would usually cost $0, but it isn't $0 by construction. The client-driven path plus the rules' "deletion in progress" lock gives the same end state for free. If you move to Blaze later, the same order can move into a callable function without changing the data model.

## §A.4 Web requests: `firebase/scripts/admin-delete-user.ts`

**The web page (needed before Play release, out of scope for P2a).** A simple page that names the app as it appears in the store, says what gets deleted, and gives an email address or form for deletion requests. It can be a GitHub Pages or Firebase Hosting page (Hosting is free on Spark). Verify the requester owns the account, for example by replying to the account's email address, before deleting.

**Running the script (Windows PowerShell, from the `firebase` folder):**

```powershell
# One time: sign in with Application Default Credentials (no key files)
gcloud auth application-default login

# 1) Dry run: shows what would be deleted, deletes nothing
node scripts/admin-delete-user.ts --project YOUR-PROJECT-ID --email person@example.com

# 2) Copy the uid it printed, then delete for real
node scripts/admin-delete-user.ts --project YOUR-PROJECT-ID --uid THE-UID --confirm THE-UID
```

**Safety:**
- It's a dry run unless `--confirm` exactly equals the uid.
- With emulator variables set, only `demo-*` projects are allowed. Without them, `demo-*` is refused.
- It prints uids and counts only, never note content, and it doesn't echo the email.

The script deletes the same things as the in-app path: Storage files, every owned doc, the profile, and the Auth user. Reply to the requester when it's done. Google asks for a "reasonably quick" turnaround.

## §A.5 What is NOT deleted (say this in the privacy policy)

- **Data only on the user's device.** That's in their control. The app offers "Delete local data".
- **Firestore backups and point-in-time recovery:** not enabled, since both cost money on Firestore. If they're ever turned on, the privacy policy must state the retention period.
- **Operational logs** that Google keeps for the Firebase project (no note content).
