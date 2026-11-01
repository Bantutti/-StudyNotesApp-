# Data inventory ({{APP_NAME}})

> **DRAFT. Not legal advice.** This inventory is the single source for the privacy policy, the terms, the deletion page and every store form. If a data flow changes, change it **here first**, then update every document that cites its ID. Last checked: November 1, 2026 (C1, Track C).

**How to read this file**

- Every data flow has an ID (**D1, D2, …**). The privacy policy, `docs/store/PLAY_DATA_SAFETY.md`, `docs/store/APPLE_PRIVACY_LABELS.md` and the deletion page cite these IDs, so a change here shows exactly which answers to revisit.
- **Phase** is the roadmap phase that ships the flow. Nothing in this file has been checked against a built app yet: every row is marked for re-checking in P7 (`VERIFY-AT-P7`, see `LEGAL_REVIEW_CHECKLIST.md` §2).
- **Flags** are switches in `web/site.config.json` that turn sections of the public privacy policy on or off. They exist because some flows depend on decisions that haven't been made yet:
  - `FILE_SYNC`: Cloud Storage needs the paid-tier Blaze plan, and Rey decided on Nov 1, 2026 to stay on the free Spark plan for now. Default **false**.
  - `VISION_AI`: P5 may send reference images to a vision AI provider, which hasn't been chosen. Default **false**.
  - `APP_CHECK`: Firebase App Check comes later through React Native Firebase (decided Nov 1, 2026). Default **false**.
- "Off the device" is what the stores call **collection**. Google Play: *"'Collect' means transmitting data from your app off a user's device."* Apple: data transmitted off the device and kept in readable form longer than needed to serve the request. Data that never leaves the phone isn't declared in either store form.

## §1 Data that stays on the device

| ID | Data | Where it lives | Leaves the device? | Phase |
|---|---|---|---|---|
| D1 | Notes (title, the note document, tags), subjects, folders, templates, custom style packs | App database (SQLite) on the phone | Only with sync (D10) or an AI action (D12) | P1 |
| D2 | Flashcards and review history (each review: card, rating 1 to 4, time, a device label) | App database | Only with sync (D10) | P4c |
| D3 | Version history (last 20 versions per note) | App database, local only (plan v0.2 §12) | Never | P1 |
| D4 | AI usage meter (requests and token counts per provider per day) and AI job status | A local file and the app database | Never. It never contains keys or note text (P3a rule) | P3a |
| D5 | The user's own AI key (Groq or Mistral) | Phone secure storage (iOS Keychain, Android Keystore) through expo-secure-store | Only to the provider the key belongs to, inside the request header, over HTTPS. Never to our backend, Firestore, analytics or logs (`V-2`) | P3a |
| D6 | Birth year from the AI age prompt (decision Q6, Nov 1, 2026) | On the device only | Never. **Must not** be put into synced settings (flag for P3b and P2b, `V-4`) | P3b |
| D7 | App settings (chosen look, preferences) | On the device | Only with sync (D10, stored as `users/{uid}.settings`) | P1 / P2b |
| D11a | Recordings, images, drawings (ink), PDF attachments | App storage on the phone | Only with file sync (D11b), transcription (D13) or the vision feature (D14) | P4, P4b, P5, P6 |
| D19 | App lock setting (Face ID, fingerprint, device PIN) | The phone's own biometric system. The app only gets a yes or no answer | Never | P2b |

**Local security, as decided for P1 (Nov 1, 2026):** no extra database encryption in P1 (the phone's own storage encryption applies; revisit in P7), **Android backups turned off** for the app, deleted text wiped after the 8-second undo, and version history capped at 20 per note. **iPhone backups** (iCloud or computer) may include app data unless the app opts out. That's undecided, so the policy says so honestly (`V-3`).

## §2 Data that leaves the device

| ID | Data | Sent to | When | Required or optional | Kept for | Phase |
|---|---|---|---|---|---|---|
| D8 | Account: email address, Firebase user ID, sign-in method. **No name or photo** (see Note 3): P2b requests only the email scope from Google and Apple and clears the top-level name and photo after every sign-in (`V-5`) | Firebase Authentication (Google, as our processor). Runs in US data centers only | Only if the user turns on sync and signs in | **Optional**: the app works fully without an account (guest mode) | Until the account is deleted. Google removes deleted users from live and backup systems **within 180 days** | P2b |
| D9 | IP address and user agent of sign-in requests | Firebase Authentication | During sign-in and sign-up | Optional (only with an account) | Firebase Auth keeps logged IP addresses **"for a few weeks"** | P2b |
| D10 | Cloud copies of D1, D2 (including the review log's **device label**, see note 1) and D7 | Cloud Firestore (Google, as processor), in documents owned by the user's ID. Rules allow only the owner | Only with sync on | Optional | Until the user deletes them or deletes the account. Firestore backups and point-in-time recovery are **not enabled** (P2a, §A.5) | P2b |
| D11b | Files: recordings, images, ink, PDFs | Cloud Storage for Firebase, under `users/{uid}/` | Only with sync on **and** `FILE_SYNC` true (needs the Blaze plan) | Optional | Until deleted or the account is deleted | P2b+, P4, P4b |
| D12 | Note text the user chose for an AI action (and the action's instructions) | **Groq** (`api.groq.com`) or **Mistral** (`api.mistral.ai`), straight from the phone with the **user's own key**. Never through our servers | Only when the user taps an AI action, after a one-time consent screen per provider, and only for users whose birth year shows 18+ | Optional | At the provider, under the user's own account terms. Groq: not kept by default; may be logged up to 30 days for reliability or abuse checks unless the user turns on Zero Data Retention. Mistral: free mode may use inputs and outputs for training unless the user opts out | P3a / P3b |
| D13 | A recording (audio), its language and the subject glossary (as a spelling hint) | **Groq** Whisper (`/openai/v1/audio/transcriptions`), straight from the phone with the user's key | Only when the user asks for a transcript (an AI feature, so 18+) | Optional | Same as D12 for Groq (inference endpoints: up to 30 days, ZDR-eligible) | P4 |
| D14 | Reference images for "Match a look" | A vision AI provider, **not chosen yet** | Only if `VISION_AI` is true and the user taps it | Optional | Depends on the provider (to be added) | P5 |
| D15 | Emails to us (support, deletion requests, tester feedback) | The app's Gmail inbox (`{{CONTACT_EMAIL}}`, Google) | When the user writes to us | Optional | Kept only as long as needed to answer. Deletion requests: a short record (date, done, no note content) kept for 12 months (`L-7`, Rey to confirm) | C1 |
| D16 | Website visitor IP address | GitHub Pages (GitHub) | Visiting our website (privacy, terms, deletion, support pages) | n/a | GitHub logs visitor IPs "for security purposes". Our pages use no cookies and no scripts | C1 |
| D17 | App Check or Play Integrity attestation tokens | Firebase App Check and Google Play Integrity | Only once `APP_CHECK` ships | Required for sync once it ships | App Check tokens are valid up to 7 days; replay-protection tokens up to 30 days | Later |

**Note 1, review log device label (D2/D10).** P2a's `reviewLogs` schema has a `device` field (1 to 64 characters). Synced, it counts as **"Device or other IDs"** on Google Play and **"Device ID"** on Apple, so both forms declare it. P4c should use a random per-install label that isn't a hardware ID (`V-6`).

**Note 3, names and photos from Google and Apple (D8; P2b plan, Nov 1, 2026).** Firebase Auth keeps two copies of profile fields: the user's top-level `displayName`/`photoURL`, and the provider's own record (`providerData`, stored on Google's servers as part of the Auth user). P2b clears the top-level copy after every sign-in, but the app can't edit `providerData`. What decides the store answer is therefore **what the provider sends**:
- **Google:** a basic request uses the scopes `openid email`; name and picture come only with the `profile` scope (Google OpenID Connect docs, read 2026-11-01).
- **Apple:** the name comes only if the app requests the full-name scope (and only on the first authorization); Apple never sends a photo (Apple Sign in with Apple docs, read 2026-11-01).
- **So:** with email-only scopes, `providerData` should hold **no name and no photo**, and neither store form declares Name. **If any name does reach `providerData`** (for example because a sign-in library adds `profile` by default), it is stored off the device longer than needed, which is "collected" under both Google's and Apple's definitions, and both forms must declare **Name**. Clearing the top-level copy doesn't change that. P7 checks real user records (`V-5`).

**Note 2, deleted notes with sync on.** In P2a's design a delete first becomes a *tombstone* (`deleted: true`) so other devices learn about it. The tombstone still holds the note's content until it's hard-deleted. The privacy policy can only promise "deleted from the cloud" if P2b **erases the content when it tombstones** or hard-deletes promptly. Flagged for the Lead (`V-7`).

## §3 Data we do not collect (v1)

- **No analytics and no crash reporting** (decision Q9, Nov 1, 2026). Bugs come from tester and user reports.
- **No advertising**, no advertising ID, no tracking, no data brokers, no selling of data.
- **No location**, contacts, calendar, phone number, SMS, health or financial data.
- **No microphone access in the background without the user starting a recording** (recording is a user action, P4).
- **Birth year (D6) and the AI key (D5)** never reach us.

## §4 Who is who

| Role | Who | Source |
|---|---|---|
| Personal information controller (data controller) | **{{DEVELOPER_LEGAL_NAME}}**, an individual developer in the Philippines (decision Q2) | RA 10173; Firebase privacy page: *"Firebase customers typically act as the 'data controller'"* |
| Processor for D8–D11b, D17 | Google (Firebase), under the Firebase Data Processing and Security Terms | firebase.google.com/support/privacy |
| Independent providers for D12–D13 | Groq and Mistral, under **the user's own account and terms**: the user creates the key and is the provider's customer | Groq Services Agreement; Mistral Commercial Terms |
| Website host for D16 | GitHub | GitHub Pages docs |
| Email for D15 | Google (Gmail) | — |

## §5 Change log

| Date | Change |
|---|---|
| 2026-11-01 | First version (C1). |
