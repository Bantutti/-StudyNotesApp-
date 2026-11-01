# Rey's setup list (C1)

> Everything Rey has to do himself for the legal pages, the stores and the closed test, in order. Each step says **FREE** or **PAID**. Facts checked on official pages on 2026-11-01 (links in `docs/legal/SOURCES.md`). Nothing here needs a Mac.

## Summary

| # | Step | Cost | When |
|---|---|---|---|
| 1 | Create the public website repo and turn on GitHub Pages | **FREE** | **ON HOLD** (Rey, Nov 1, 2026: no publishing for now) |
| 2 | Create the app's Gmail address | **FREE** | Now |
| 3 | Send the Lead your legal name and the new email (fills the placeholders) | **FREE** | After step 2 |
| 4 | Google Play developer account | **PAID: US$25 once** | Before P6 (verification takes time) |
| 5 | Apple Developer Program | **PAID: US$99 per year** | Only when you're ready for the iPhone release |
| 6 | Legal review of the drafts | **FREE or low cost** (a university legal aid clinic) or **PAID** (a private lawyer) | Before production release |
| 7 | National Privacy Commission (NPC): register or file a sworn declaration | Registration **FREE** to file; **notarization costs a fee** either way | After the legal review |
| 8 | Handle web deletion requests | **FREE** | Once sync is live |
| 9 | Decisions only you can make | — | See §9 |
| 10 | Closed test tools | **FREE** | Start of P6 |
| 11 | (Optional) your own domain name | **PAID yearly** | Optional, later |

## §1 Public website repo and GitHub Pages (FREE)

> **ON HOLD.** Rey decided on Nov 1, 2026 (2:45 PM): **no publishing for now.** No public repo, no GitHub Pages, no public pages. Everything stays as drafts in the private repo and Drive. Keep these steps for later: Play's closed test can't start until the privacy policy URL is public (`PLAY_APP_CONTENT.md`), so publishing has to happen before P7.

GitHub Free includes Pages for **public** repositories only, so the site needs its own public repo; the main app repo stays private. Note: GitHub logs the IP addresses of visitors to Pages sites (stated in our privacy policy §5).

1. On github.com (signed in as **Bantutti**), click **+ → New repository**.
2. Name: **studynotes-site**. Visibility: **Public**. Leave "Add a README" **unticked** (empty repo).
3. Give the GitHub app the agents use access to it, the same way you did for `-StudyNotesApp-`: **your profile → Settings → Applications → Installed GitHub Apps → Configure → Repository access**, and add `studynotes-site`.
4. Tell the Lead. An agent then pushes the contents of `web/public/` to the repo's `main` branch.
5. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, Branch **main**, folder **/ (root)**, **Save**.
6. After a few minutes your site is at **https://bantutti.github.io/studynotes-site/**. Check that `/privacy.html`, `/terms.html`, `/delete-account.html` and `/support.html` open.
7. Send the Lead that address. It becomes `SITE_BASE_URL`, and these are the links you paste into Play Console and App Store Connect.

Your GitHub username appears in the address. A custom domain (§11) would hide it, but costs money every year.

## §2 The app's Gmail address (FREE)

1. Create a new Google account just for the app, for example `<appname>.app@gmail.com` (decide after the name is final, §9).
2. Turn on **2-Step Verification** and add a recovery phone.
3. This address will be **public**: on the store listings, the privacy policy, the support page and the deletion page. Don't use your personal email (decision Q3).
4. If you register with the NPC later (§7), the NPC asks for a **dedicated DPO email** separate from personal email; this address can serve that purpose.
5. Create Gmail **labels**: `deletion-request`, `support`, `tester-feedback`.

## §3 Filling the placeholders (FREE)

Send the Lead these values; the Track C worker puts them into `web/site.config.json` and rebuilds the site:

| Placeholder | Value | Status |
|---|---|---|
| `APP_NAME` | **NotedPo** (final, confirmed Nov 1, 2026). App id `io.github.bantutti.notedpo` (final; P1 sets it in `app.json`) | **Final** |
| `DEVELOPER_LEGAL_NAME` | Your full **legal** name, exactly as on your ID. It must match your Play and Apple developer accounts, because Play requires the developer named on the listing to appear in the privacy policy | Waiting |
| `CONTACT_EMAIL` | The Gmail from §2 | Waiting |
| `SITE_BASE_URL` | From §1 step 7 | Waiting |
| `EFFECTIVE_DATE` | The day the policy is first published for the closed test | Set at publishing |

The pages show any empty placeholder as `{{NAME}}`, and `node web/build-site.mjs --release` refuses to build until all are filled and `status` is `final`.

## §4 Google Play developer account (PAID: US$25 one-time)

Source: [Get started with Play Console](https://support.google.com/googleplay/android-developer/answer/6112435).

1. You must be **at least 18** and have a Google Account (you may use the app Gmail or your own; the **developer name** shown on Play comes from what you enter).
2. Sign up at play.google.com/console, accept the Developer Distribution Agreement, and pay **US$25 once**. Cards: Mastercard, Visa, American Express, Visa Electron. **Prepaid cards are not accepted.**
3. Choose account type **Personal**.
4. **Identity verification:** Google may ask for a **government ID and a credit card, both in your legal name**. If they're found invalid, the fee isn't refunded.
5. **Device verification:** personal accounts must verify access to an Android device with the **Play Console mobile app** before publishing.
6. Because the account is new and personal, you must pass the **closed test** (12+ testers for 14 continuous days) before production. See `CLOSED_TEST_PLAN.md`.
7. Then fill the app setup with the C1 docs: `PLAY_APP_CONTENT.md`, `PLAY_DATA_SAFETY.md`, `AGE_RATINGS.md`, `STORE_LISTING.md`.

**Do this before P6**, so verification delays don't hold up the closed test.

## §5 Apple Developer Program (PAID: US$99 per year), later

Source: [Apple Developer Program enrollment](https://developer.apple.com/programs/enroll/).

- Needed to publish on the App Store and for TestFlight. Not needed now (decision: iPhone uses Expo Go until then).
- Requirements: an Apple Account with **two-factor authentication**, being the **legal age of majority** in your region, and your **legal name** in the account. Apple confirms your email, phone and address (no P.O. boxes).
- **Your legal name is shown as the seller** on the App Store.
- Cost: **99 USD per membership year**, in local currency where available.
- Then use `APPLE_PRIVACY_LABELS.md` and `AGE_RATINGS.md` §2.

## §6 Legal review (decision Q12 A)

- Take `docs/legal/LEGAL_REVIEW_CHECKLIST.md` plus the privacy policy, terms and deletion page to a **university legal aid clinic** (often free or low cost) or a lawyer you know. A private lawyer is **PAID**.
- Ask specifically about the **red items** in the checklist (Groq's "not for consumer use" term, minors and the Data Privacy Act, and the NPC question in §7).
- The closed test can run on the drafts (they say "Draft" on the website). The production release should wait for the review.

## §7 National Privacy Commission: choose one after the legal review

Legal review item `L-21` in `docs/legal/LEGAL_REVIEW_CHECKLIST.md`.

Source: [NPC Circular 2022-04](https://privacy.gov.ph/wp-content/uploads/2023/05/Circular-2022-04.pdf) and the [NPC FAQs](https://privacy.gov.ph/pips-and-pics/faqs/).

- **Mandatory registration** applies only if you employ 250 or more people, process **sensitive** personal information of **1,000 or more** people, or your processing is **likely to pose a risk** to people's rights (minors are listed as vulnerable data subjects). Ask the reviewer whether any applies to you.
- If not mandatory, the circular says you either **register voluntarily** (online in the NPC registration system, with a dedicated DPO email and a **notarized** DPO form) or file a **notarized sworn declaration** (Annex 1 of the circular).
- **Cost:** the online filing itself has no fee shown on the pages read today, but **notarization costs a fee** (ask a local notary).

## §8 Handling deletion requests sent by email (FREE)

Promise on the website: **done within 7 days** of the person confirming (decision Q4). Tools: P2a's admin script `firebase/scripts/admin-delete-user.ts` (see `docs/backend/ACCOUNT_DELETION.md` §A.4), the Google Cloud CLI (free) and the real Firebase project (not created yet).

1. A request arrives at the app Gmail with the subject "Delete my … account". Label it `deletion-request`.
2. **Verify:** reply **to the account's email address** (not just the sender) asking them to confirm. Don't delete anything for an address that isn't on an account.
3. In PowerShell, from the `firebase` folder, run the **dry run** first (it deletes nothing and prints the user id and counts):
   `node scripts/admin-delete-user.ts --project YOUR-PROJECT-ID --email person@example.com`
4. Then delete for real with the printed uid:
   `node scripts/admin-delete-user.ts --project YOUR-PROJECT-ID --uid THE-UID --confirm THE-UID`
5. Reply "Your account and data have been deleted."
6. Keep a one-line record (date received, date done) in a private sheet for 12 months, then delete it (`L-7`). Don't copy notes or other content into it.

The same inbox also handles other privacy requests (access, correction). Answer them within a reasonable time; most can be done by the user in the app.

## §9 Decisions only Rey can make

| Decision | Options | Where it matters |
|---|---|---|
| ~~App name and app id~~ **Decided** | **NotedPo** and **`io.github.bantutti.notedpo`** (final, Nov 1, 2026). Still do a trademark search before launch, mainly against Digital Workroom's "Noted" | `STORE_LISTING.md` §1; fixes the permanent package name |
| Give app reviewers a test AI key? | (a) No: reviewers get their own free Groq key (instructions in `PLAY_APP_CONTENT.md` §3). (b) Yes: a separate free Groq key just for review, deleted after approval | Play App access, Apple App Review notes |
| Keep a 12-month record of deletion requests? | Yes as drafted, or a shorter time | Privacy policy §5, §8; deletion page |
| Publish a postal address or phone on the Support page? | Email only (as drafted), or add more if the legal review says local law requires it (`L-17`). Apple asks for "actual contact information" | `web/content/support.md` |
| Move to the Blaze plan for file sync? | Stay on Spark (files stay on the phone), or Blaze (billing account, budget alert) | Flips `FILE_SYNC`; changes the policy and both store forms |
| iPhone backups of app data | Leave the iOS default, or have P1/P7 exclude app data from iCloud backup | Privacy policy §2 (`V-3`) |

## §10 Closed test tools (FREE)

- A **Google Form** for the survey in `CLOSED_TEST_PLAN.md` §6.
- The tester list as an **email list** in Play Console (paste the Gmail addresses), or a Google Group.
- A copy of `closed-test-tracker.csv` in **your private Drive** (it holds names and emails; never commit a filled copy).
- A group chat for reminders.

## §11 Optional: your own domain (PAID yearly)

A domain like `yourapp.com` makes the URLs independent of your GitHub username. If you add one later, update the URLs in Play Console and App Store Connect at the same time (Play policy: no broken links to the deletion page).

## Optional for your own testing: Groq Zero Data Retention (FREE)

For your own Groq key: **console.groq.com → Data Controls → Zero Data Retention**. This affects only your key; each user controls their own.
