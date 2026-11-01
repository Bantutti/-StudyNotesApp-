# Google Play Data safety form: proposed answers

> **DRAFT. Not legal advice.** Fill this in Play Console only when the app setup is done, and fill it for **the features actually in the build you upload** (Play: the form is *"the sum of your app's data collection and sharing across all its versions currently distributed on Google Play"*). Every answer cites a data ID from `docs/legal/DATA_INVENTORY.md`. Re-check everything at P7 (`VERIFY-AT-P7`, see `docs/legal/LEGAL_REVIEW_CHECKLIST.md`).
>
> **Sources (read 2026-11-01):** [Data safety help](https://support.google.com/googleplay/android-developer/answer/10787469), [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311), [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111), [Firebase Play disclosure](https://firebase.google.com/docs/android/play-data-disclosure) (page updated 2026-10-28; it describes Firebase's **Android** SDKs, while our app uses the Firebase **JS** SDK, so P7 confirms by checking network traffic, `V-14`).

## §0 Key definitions from Google (they drive every answer)

- **Collect:** *"transmitting data from your app off a user's device"*, including data sent by libraries or SDKs, *"irrespective of whether data is transmitted to you or a third-party server."* So notes sent straight to Groq count as **collected** (decision Q8 A).
- **Not collection:** data processed only on the device, or sent end-to-end encrypted. So D1–D7 and D19, while they stay on the phone, are **not declared**.
- **Not sharing:** transfers to a **service provider** acting for us (Google Firebase), and transfers *"based on a specific user-initiated action, where the user reasonably expects the data to be shared, or based on a prominent in-app disclosure and consent"*. The AI sends (D12, D13) happen only when the user taps an action, after a consent screen per provider, so they are **not shared** (decision Q8 A, `L-5`).
- **Optional:** allowed when *"a user has control over its collection and can use the app without providing it"*, for example *"user data that is only collected when a user signs in where users have the ability to engage with the app without being signed-in."* Guest mode makes **every** type optional.
- **Ephemeral:** *"only stored in memory and retained for no longer than necessary to service the specific request in real-time."* Groq may log requests up to 30 days and Firebase stores synced data, so **nothing is marked ephemeral**.

## §1 Section "Data collection and security"

| Question | Answer | Why |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | Sync (D8–D11b) and AI actions (D12–D13) send data off the device |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Firebase encrypts in transit with HTTPS (Firebase privacy page); AI calls go to fixed HTTPS hosts only (P3a design) |
| Do you provide a way for users to request that their data is deleted? | **Yes** | In-app deletion (P2a module, P2b screen) and the web page (D15 route) |

**Account deletion questions** (part of this form, Play policy 13327111):

| Question | Answer |
|---|---|
| Does your app let users create an account? | **Yes**, optionally (email and password, Sign in with Google, Sign in with Apple). Accounts exist only for sync; the app works without one |
| Delete account URL | `{{SITE_BASE_URL}}/delete-account.html` |
| Can users request deletion of some data without deleting their account? | **Yes**: users delete notes, cards and files in the app, and with sync on they're removed from the cloud. This answer holds **only if** P2b erases tombstoned content (`V-7`) |

## §2 Section "Data types": what to tick

Tick only the rows marked **Tick** for the build being submitted.

| Play category → data type | Tick? | Data IDs | Shipped by |
|---|---|---|---|
| Personal info → **Email address** | Tick | D8 | P2b |
| Personal info → **User IDs** | Tick | D8 (Firebase user ID) | P2b |
| Personal info → **Name** | **Don't tick**, provided the P7 check passes. P2b requests only the email scope and clears the top-level name. **Tick it** if P7 finds a name in any user's `providerData` (inventory Note 3, `V-5`): the provider's stored copy still counts as collected | D8 | P2b |
| App activity → **Other user-generated content** | Tick | D10 (synced notes, subjects, cards, review history, settings), D12 (note text sent to AI), drawings if `FILE_SYNC` | P2b, P3 |
| Audio → **Voice or sound recordings** | Tick once P4 ships | D13 (sent to Groq for transcripts); D11b if `FILE_SYNC` | P4 |
| Photos and videos → **Photos** | Tick **only if** `FILE_SYNC` (synced images) or `VISION_AI` (D14) | D11b, D14 | P2b+, P5 |
| Files and docs | Tick **only if** `FILE_SYNC` (synced PDF attachments) | D11b | P2b+ |
| Device or other IDs | Tick | D2/D10: the review log's `device` label is synced (Note 1 in the inventory). Later also D17 (App Check) | P4c, later |
| Location (approximate or precise) | **No** | Firebase Auth logs IP addresses for security (D9), but the app never uses them to work out location. Play says IP must be declared as location only when location is *inferred* from it. The IP FAQ answer didn't render today, so read it in the console (`V-14`) | — |
| App info and performance → Crash logs, Diagnostics | **No** | No crash reporting or analytics in v1 (decision Q9) | — |
| Personal info → Other info (birth year) | **No** | D6 never leaves the phone | — |
| Financial, health, messages, contacts, calendar, web browsing, installed apps, search history | **No** | Not collected | — |

## §3 Section "Data usage and handling": answers per ticked type

The same five questions appear for each ticked type. Proposed answers:

| Data type | Collected, shared or both? | Processed ephemerally? | Required or optional? | Why collected? (purposes) |
|---|---|---|---|---|
| Email address | **Collected** | No | **Users can choose** (only with an account) | **App functionality**, **Account management** |
| User IDs | **Collected** | No | Users can choose | **App functionality**, **Account management** |
| Name (only if ticked) | Collected | No | Users can choose | **Account management** |
| Other user-generated content | **Collected** | No | Users can choose | **App functionality** |
| Voice or sound recordings | **Collected** | No | Users can choose | **App functionality** |
| Photos (only if ticked) | Collected | No | Users can choose | App functionality |
| Files and docs (only if ticked) | Collected | No | Users can choose | App functionality |
| Device or other IDs | **Collected** | No | Users can choose (only with sync) | **App functionality** |

**Never tick** Analytics, Developer communications, Advertising or marketing, Personalization, or Fraud prevention for our own use. (Firebase uses IP addresses for abuse prevention as our processor; that's covered under the account rows, `L-6`.)

**"Shared"**: answer **No** for every type (§0: Firebase is a service provider; AI sends are user-initiated with consent).

## §4 Other declarations on this form

| Item | Answer |
|---|---|
| Committed to follow the Play Families Policy | Not applicable (the app isn't aimed at children; target audience 13+) |
| Independent security review (MASA) | **No** (optional and paid for by the developer; not planned) |

## §5 What the store listing will show (preview, expected)

- Data shared with third parties: **No data shared with third parties**
- Data collected: Personal info, App activity, Audio, Device or other IDs (plus Photos and Files if `FILE_SYNC`)
- Data is encrypted in transit
- You can request that data be deleted

## §6 Things that change these answers

| If… | Then… |
|---|---|
| Rey moves to the Blaze plan and file sync ships (`FILE_SYNC` true) | Tick Photos and Files and docs; drawings stay under Other user-generated content |
| App Check ships (`APP_CHECK` true) | Re-read Firebase's App Check and Play Integrity disclosures; the Device or other IDs purpose may gain **Fraud prevention, security, and compliance** |
| A vision AI provider is chosen for P5 (`VISION_AI` true) | Tick Photos; add the provider to the privacy policy |
| Analytics or crash reporting are ever added | Tick Crash logs, Diagnostics or App interactions as needed, update the privacy policy **first** |
| A new AI provider is added | Update the privacy policy §4 and the consent screen; types usually stay the same |
