# App Check, budget alerts, rate limits and costs: the plan for the real project

P2a runs **only on the emulators** (project `demo-studynotes`). This page is the checklist for when a real Firebase project is created. Prices were checked on **Nov 1, 2026** at firebase.google.com/pricing. Re-check them before creating the project.

## 1. What's free and what costs money

| Service | Free (Spark, or Blaze's free tier) | Costs money |
|---|---|---|
| **Firestore** (1 free database per project) | 1 GiB stored, **50K reads, 20K writes, 20K deletes per day**, 10 GiB egress per month | Usage above that. TTL deletes, backups, point-in-time recovery and restores are **never** free. |
| **Auth**: email, Google, Apple | No charge on the base product | Phone/SMS sign-in (not used). The optional Identity Platform upgrade: Spark capped at 3,000 daily users; Blaze free to 50K monthly users, then $0.0025 to $0.0055 each. |
| **Cloud Storage** | **Not available on Spark.** On Blaze, new `*.firebasestorage.app` buckets in **us-central1, us-east1 or us-west1** only: 5 GB-month stored, 100 GB per month download, **5,000 uploads per month**, 50,000 downloads per month | Everything on Blaze above that, and any bucket in another region |
| **App Check** | No charge. Play Integrity standard tier: 10,000 checks per day. Apple App Attest and DeviceCheck: Apple's limits | — |
| **Hosting** (for the deletion web page) | 10 GB stored, 360 MB per day transfer | Above that |
| **Budget alerts** | No charge | They only **notify**. Blaze has **no hard spending cap**. |
| Apple Developer Program | — | About $99 per year (needed for App Attest on a real iPhone build) |
| Google Play developer account | — | About $25 one-time |

**Decision (Nov 1 2026): stay on Spark for now.** Firestore and Auth work on Spark, where the free limits are **hard caps**: the app just stops writing for the day, and you never get a bill. Cloud Storage (audio, images, ink, PDFs) needs Blaze. Until you decide, those files stay on the device and in the full-data-export ZIP. The Storage rules are written and tested, ready for when you switch.

## 2. What the rules cannot enforce

| Can't enforce | Why | Free mitigation in place | Paid option |
|---|---|---|---|
| True rate limits (requests per minute) | Rules see one request at a time and have no memory | Page limit of 500 per query; size caps on every field; a write needs a verified email; App Check (below) | A counter doc updated by Cloud Functions, or a callable function as the only write path |
| Total storage per user | Rules can't sum across docs | Every Storage file needs an asset doc with an exact size, so usage can be totalled; per-file caps | A function that sums sizes and blocks uploads over a quota |
| Number of docs per user | Same | Spark's hard daily caps; budget alerts on Blaze | A function-maintained counter |
| Inside JSON strings, and every item of `bookmarks` | Rules can't parse JSON or loop | zod checks on load (required in the sync module) | — |

Why there's no per-document write throttle: a "one write per second per doc" rule would break Firestore's offline queue, which replays several saves of the same note back to back. It also wouldn't bound cost, because an abuser simply writes to many docs.

## 3. App Check

**What it does:** Firebase rejects requests that don't come from your genuine app on a real device. This is the main defence against someone using your project's (public) config to script abuse.

**The catch with Expo:** native attestation (Play Integrity, App Attest) needs **React Native Firebase** (`@react-native-firebase/app-check`). That is native code, so it needs a **development build** and **does not work in Expo Go**. A real-iPhone dev build needs the paid Apple account. The Firebase JS SDK has no native providers.

**Plan (this belongs to P2's app side; P2a only documents it):**
1. P2 (app side) decides between: (a) the JS SDK now, with App Check later when dev builds exist, or (b) React Native Firebase from the start (no Expo Go for sync features).
2. When dev builds exist: register the Android app (Play Integrity) and the iOS app (App Attest with DeviceCheck fallback) in the console. Use **debug tokens** for emulators and CI (keep them in EAS secrets, never in the repo).
3. Turn on App Check **monitoring** first, and watch the "verified vs unverified requests" chart for a week or two.
4. Then turn on **enforcement** for Firestore and Storage.
5. Play Integrity only gives good tokens to apps installed from Play, including internal and closed testing tracks. Use the closed test (needed anyway: 12 testers for 14 days) to check this.

## 4. Budget alerts (when you move to Blaze)

1. Google Cloud console → Billing → Budgets & alerts → Create budget for the project.
2. Suggested amounts for a student project: **₱100 per month** budget, with alerts at **50%, 90% and 100%**, plus a forecast alert at 100%.
3. Email goes to the billing admin (you). Optionally add a Pub/Sub topic for automation later.
4. Remember: **alerts do not stop spending.** For a true cap, Google documents a Cloud Function that disables billing when the budget is exceeded. It needs Functions (Blaze) and switches off **all** paid services when it fires. Not set up in P2a.
5. Also: Firestore → Usage tab, and Storage → Usage tab. Check them weekly during the beta.

## 5. Real-project setup checklist (not done in P2a)

1. Create a **separate test project** first (rule 4.6: never test on production data), e.g. `studynotes-test`. Production comes later.
2. Firestore: create the **(default)** database in **Native mode**. Location: `asia-southeast1` (Singapore) is closest to Cebu. The free quota covers the first database whatever its location (verify on the create screen). The location **can't be changed later**.
3. Storage (only after choosing Blaze): create the bucket in **us-central1** (or us-east1 or us-west1) to get the free tier. Cross-region traffic between Singapore Firestore and a US bucket doesn't matter for this design.
4. Deploy rules and indexes from the `firebase` folder: `npx firebase deploy --only firestore:rules,firestore:indexes,storage --project <id>`. The Storage rules read Firestore, so **the console asks you to grant the Storage service account access to Firestore. Accept it**, or every upload is denied.
5. Auth: enable Email/Password (with verification), Google, and Apple. Don't upgrade to Identity Platform unless you need its features.
6. Privacy: Philippine Data Privacy Act (RA 10173). The privacy policy must say data is stored with Google (Singapore and US regions) and how deletion works (ACCOUNT_DELETION.md §A.5).
7. Set up budget alerts (section 4) **before** upgrading to Blaze.
8. Re-run `npm test` here against the emulators after any rules change, before every deploy.
