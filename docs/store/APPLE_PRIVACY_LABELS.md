# App Store privacy labels ("App Privacy" in App Store Connect): proposed answers

> **DRAFT. Not legal advice.** iPhone release needs the paid Apple Developer Program (99 USD per year), which Rey doesn't have yet, so this is prepared ahead. Every answer cites `docs/legal/DATA_INVENTORY.md`. Re-check at P7 (`VERIFY-AT-P7`).
>
> **Sources (read 2026-11-01):** [App privacy details](https://developer.apple.com/app-store/app-privacy-details/), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (5.1.1, 5.1.2), [Offering account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

## §0 Apple's definitions that drive the answers

- **Collect:** *"transmitting data off the device in a way that allows you and/or your third-party partners to access it for a period longer than what is necessary to service the transmitted request in real time."* Synced data is stored, so it's collected. Groq may log AI requests for up to 30 days, so the AI sends are declared too (decision Q8 A).
- **Third-party partners:** *"analytics tools, advertising networks, third-party SDKs, or other external vendors whose code you've added to your app."* The Firebase SDK is in the app, so Firebase's collection is ours to declare.
- **Free text and recordings:** *"Mark 'Other User Content' to represent generic free form text fields and 'Audio Data' for voice recordings."*
- **Optional disclosure** needs **all** of: not used for tracking, infrequent, not part of the primary functionality, and optional for the user. Sync and AI are main features, so **no exemption is used**.
- **Tracking:** linking data with third-party data for advertising, or sharing with a data broker. We do **neither**.

## §1 First question

| Question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | **Yes** |

## §2 Data types to select

| Apple category → type | Select? | Data IDs | Phase |
|---|---|---|---|
| Contact Info → **Email Address** | Yes | D8 | P2b |
| Contact Info → **Name** | **Only if** Firebase Auth keeps the Google/Apple display name (`V-5`). Recommended: P2b clears it, then don't select | D8 | P2b |
| Identifiers → **User ID** | Yes | D8 (Firebase user ID) | P2b |
| Identifiers → **Device ID** | Yes | D2/D10: the review log's `device` label (inventory Note 1) | P4c |
| User Content → **Other User Content** | Yes | D10 (notes, cards, review history, settings, drawings), D12 (text sent to AI) | P2b, P3 |
| User Content → **Audio Data** | Yes, once P4 ships | D13 (Groq transcripts); D11b if `FILE_SYNC` | P4 |
| User Content → **Photos or Videos** | **Only if** `FILE_SYNC` or `VISION_AI` | D11b, D14 | later |
| Diagnostics (crash, performance) | **No** | No crash reporting (decision Q9) | — |
| Usage Data, Location, Contacts, Health, Financial, Browsing, Search History, Purchases, Sensitive Info | **No** | Not collected | — |
| (Birth year) | **No** | D6 stays on the device | — |

## §3 Questions for each selected type

| Type | Purposes | Linked to the user's identity? | Used for tracking? |
|---|---|---|---|
| Email Address | **App Functionality** (sync sign-in). Apple's purpose list has no separate "account management", so app functionality covers it | **Yes** (it's the account) | **No** |
| Name (only if selected) | App Functionality | Yes | No |
| User ID | App Functionality | Yes | No |
| Device ID | App Functionality (merging reviews from several devices) | Yes (stored with the account's review history) | No |
| Other User Content | App Functionality | **Yes** (synced copies sit in the user's account) | No |
| Audio Data | App Functionality | Yes if synced; the Groq transcript request itself isn't linked to the account by us. Answer **Yes** because the type as a whole is linked when file sync exists, otherwise **No** (`V-16`) | No |
| Photos or Videos (only if selected) | App Functionality | Yes | No |

**Never select** Third-Party Advertising, Developer's Advertising or Marketing, Analytics, Product Personalization or Other Purposes.

## §4 Expected product page summary

- **Data Linked to You:** Contact Info, Identifiers, User Content
- **Data Used to Track You:** none
- **Data Not Linked to You:** none (or Audio Data if file sync never ships, `V-16`)

## §5 Other Apple privacy requirements that C1 covers

| Requirement (guideline) | Where it's met |
|---|---|
| Privacy policy link in App Store Connect **and** inside the app (5.1.1(i)) | `{{SITE_BASE_URL}}/privacy.html`; in-app link flagged for P2b (Me screen) |
| Account deletion inside the app (5.1.1(v)); no email or phone steps for normal apps | P2a module plus P2b screen. The web page is an extra route, not a replacement |
| Sign in with Apple: revoke tokens with the Sign in with Apple REST API on deletion | Flagged for P2b (P2a's `deleteAccount` has no revoke step) |
| Disclose sharing with **third-party AI** and get explicit permission first (5.1.2(i)) | Privacy policy §4 and the per-provider consent screen (P3b, explicit yes) |
| Privacy manifest (`PrivacyInfo.xcprivacy`) and required-reason APIs | **Not verified today.** P7 checks Expo's generated manifest against Apple's current rules (`V-17`) |
| Support URL with real contact information | `{{SITE_BASE_URL}}/support.html`; postal address or phone question is `L-17` |
