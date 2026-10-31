<!-- internal -->
> **DRAFT for review. Not legal advice.** This is the "web link resource" Google Play requires for account deletion without the app (support.google.com/googleplay/android-developer/answer/13327111, read 2026-11-01). Play's rules for this page: it must clearly reference the app or developer as shown on the store listing; it must let users ask for deletion without reinstalling the app; deletion must remove the data (freezing doesn't count); any data kept must be disclosed; and the link goes in Play Console's Data safety form. Requests are handled by Rey with P2a's `firebase/scripts/admin-delete-user.ts` (dry run first), see `docs/store/REY_SETUP.md` §8. The 7-day answer time is decision Q4 (Nov 1, 2026).
<!-- /internal -->

# Delete your {{APP_NAME}} account

This page explains how to delete your **{{APP_NAME}}** account and data. {{APP_NAME}} is a study notes app for Android and iPhone by **{{DEVELOPER_LEGAL_NAME}}**.

**Using {{APP_NAME}} without an account?** Then we have no account or data to delete: everything is on your phone. Delete the app, or delete your notes in the app, to remove it.

## Option 1: In the app (fastest)

1. Open {{APP_NAME}} and go to the **Me** tab.
2. Tap **Account**, then **Delete account**.
3. Confirm. You may be asked to sign in again for security.

Deletion starts right away. [VERIFY-AT-P7 V-11]

## Option 2: By email, if you no longer have the app

1. Send an email to **{{CONTACT_EMAIL}}**, **from the email address you used for your {{APP_NAME}} account**.
2. Use the subject **Delete my {{APP_NAME}} account**. You don't need to write anything else.
3. To protect your account, we will reply to your account's email address and ask you to confirm. (If you signed in with Apple and chose "Hide My Email", our reply reaches you through Apple's relay address.)
4. After you confirm, we delete your account and data and email you when it's done.

**We complete deletion requests within 7 days** of your confirmation.

## What is deleted

- Your account (email address, user ID and sign-in details)
- Your synced notes, subjects, folders, templates and custom looks
- Your synced flashcards and review history
- Your synced settings
- Any synced recordings, images, drawings and PDF attachments

## What is not deleted, or is kept for a while

- **Data only on your phone.** We can't reach it. Delete the app, or use **Delete local data** in the app, to remove it.
- **Google's backups.** Our database runs on Google Firebase. Google removes deleted accounts from its backup systems within 180 days.
- **Sign-in security logs.** Firebase keeps the IP address of sign-in requests for a few weeks.
- **Text or recordings you sent to an AI company** (Groq or Mistral) with your own key. That company's own rules apply; contact it directly.
- **A short record of your request** (the date and that it was completed, with no notes) for 12 months, to show we handled it. [LAWYER L-7]

## Deleting some data without deleting your account

You can delete individual notes, flashcards, recordings and files in the app at any time. With sync on, they are removed from the cloud too. [VERIFY-AT-P7 V-7]

Questions? Email **{{CONTACT_EMAIL}}**. See also our [Privacy Policy](PRIVACY_POLICY.md).
