# Legal review and P7 verification checklist

> **DRAFT. Not legal advice.** Plan v0.2 §18: *"This plan is not legal advice; confirm obligations with a qualified professional before launch."* This file lists every marker used in `docs/legal/` and `docs/store/`:
> - **`L-n` (LAWYER):** a question for the legal reviewer (decision Q12 A: a free or low-cost review before production).
> - **`V-n` (VERIFY-AT-P7):** a claim about the app that P7 must check against the built app. If a check fails, change the app or change the documents (and the store forms) before release.
>
> Priority: 🔴 could block launch or create real liability · 🟠 should be settled before production · 🟢 wording or confirmation.

## §1 Questions for the legal reviewer (L)

| ID | Priority | Question | Where |
|---|---|---|---|
| L-14 | 🔴 | **Groq's terms.** The Groq Services Agreement says its services are *"for developers, businesses, or enterprise organizations"* and *"not for consumer use"*, and users must be 18+. Our app asks students to create their own Groq key. Is a student using their own key inside our app "consumer use"? Does the user, or we, carry the risk? Is our Terms §3 wording enough? | Terms §3, Privacy §4 |
| L-20 | 🔴 | **Mistral's terms.** Mistral's consumer terms exclude *"access to any of our APIs, which are limited to business customers"*. The Commercial Terms forbid letting *"minors use the Mistral AI Products without legally adequate consent from their parent or guardian"* and children's data under 13. Can individual students lawfully use their own Mistral API key, even at 18+? | Terms §3, Privacy §4 |
| L-10 | 🔴 | **Minors under the Data Privacy Act.** The app is for 13+. Do users aged 13–17 who turn on sync need parental consent under RA 10173 and NPC guidance? Is "use with a parent's knowledge" in the Terms enough? | Privacy §11, Terms §1, `PLAY_APP_CONTENT.md` |
| L-21 | 🔴 | **NPC filing.** Is Rey under mandatory registration (NPC Circular 2022-04 §5: 250+ employees, sensitive personal information of 1,000+ people, or processing likely to pose a risk, with minors listed as vulnerable)? If not, voluntary registration or the notarized sworn declaration (Annex 1)? | `REY_SETUP.md` §7 |
| L-4 | 🟠 | **AI age gate.** Is a self-declared birth year (no default, neutral wording) enough to restrict AI to 18+? Should we block retrying with a different year? | Privacy §4, Terms §1, `AGE_RATINGS.md` §3 |
| L-5 | 🟠 | **"Not shared" on Play.** We declare AI sends as collected but **not shared**, relying on Play's exception for *"a specific user-initiated action… or… prominent in-app disclosure and consent"* (decision Q8 A). Is this defensible? | `PLAY_DATA_SAFETY.md` §0 |
| L-1 | 🟠 | **Controller identity.** Rey as an individual personal information controller under his legal name (decision Q2). Anything else to state (address)? | Privacy §1 |
| L-2 | 🟠 | **Cross-border transfer.** Firebase Auth runs in the US; other services may process data elsewhere. Is our disclosure enough under the DPA? | Privacy §3 |
| L-22 | 🟠 | **Lawful basis.** The IRR asks for the *"basis of processing, when processing is not based on the consent of the data subject"*. We state: sync = to provide the service the user asked for; AI = consent. Correct framing? | Privacy §3, §4 |
| L-11 | 🟠 | **Breach notification.** We promise to tell users and the NPC "when the law requires it". Check the NPC's breach rules and deadlines and whether to state them | Privacy §12 |
| L-15 | 🟠 | **Warranty and liability** limits under Philippine consumer law (RA 7394) for a free app; non-waivable rights | Terms §5 |
| L-17 | 🟠 | **Support page contact.** Apple's Support URL must lead to *"actual contact information (legal address, email address, telephone number), as may be required by local law"*. Is email-only enough, or must an individual developer publish an address or phone? | `web/content/support.md` |
| L-19 | 🟠 | **Trademark search** for the final app name ("Noted" clashes with Digital Workroom's app) | `STORE_LISTING.md` §1 |
| L-3 | 🟢 | Wording about the developer's technical ability to access synced data (no end-to-end encryption) | Privacy §3 |
| L-6 | 🟢 | Firebase's abuse-prevention use of IP addresses as our processor: no separate purpose ticked on Play | `PLAY_DATA_SAFETY.md` §3 |
| L-7 | 🟢 | Keeping a 12-month record of deletion requests (date and done, no content) | Privacy §5, §8; deletion page |
| L-8 | 🟢 | The retention table as a whole | Privacy §8 |
| L-9 | 🟢 | List of data subject rights (RA 10173 §16, §18; IRR §34, §36) and the NPC complaint route | Privacy §10 |
| L-12 | 🟢 | Minimum age 13 and parental knowledge wording | Terms §1 |
| L-13 | 🟢 | Scope of the permission users give us to store their content | Terms §2 |
| L-16 | 🟢 | Philippine governing law; any venue clause | Terms §8 |
| L-18 | 🟢 | US state app store age laws (Texas SB 2420 in effect per Google, 2026-11-01) before any US release | `AGE_RATINGS.md` §3 |

## §2 Checks for P7 against the built app (V)

| ID | Claim to verify | How to check | Owner |
|---|---|---|---|
| V-1 | No extra DB encryption; app lock returns only success or failure | Read P1/P2b code and docs | P7 |
| V-2 | The AI key never reaches our backend, Firestore, analytics or logs | P3a's "key never in logs" test; network capture | P7 |
| V-3 | Android auto-backup is off for app data; iOS backup behaviour matches the policy | `app.json` / manifest (`allowBackup`), iOS settings | P7 |
| V-4 | The birth year stays on the device and is not in synced `settings` | Inspect a synced `users/{uid}.settings` | P7 |
| V-5 | Whether Firebase Auth stores the Google/Apple display name and photo URL; ideally P2b clears them | Firebase console, user record after a Google sign-in | P2b / P7 |
| V-6 | The review log `device` label is a random per-install id, not a hardware id | P4c code | P7 |
| V-7 | Deleting a note with sync on erases its content from the cloud (tombstones carry no content, or are hard-deleted promptly) | Delete a note, read the Firestore doc | **P2b must build**, P7 checks |
| V-8 | Files are not synced while `FILE_SYNC` is false | Network capture; no Storage uploads | P7 |
| V-9 | Transcription sends audio, language and glossary only to Groq | Network capture | P7 |
| V-10 | A per-subject "AI off" switch exists | UI check | P3b / P7 |
| V-11 | In-app deletion is at Me → Account → Delete account and starts immediately | UI check, P2a module tests | P2b / P7 |
| V-12 | Users can view, edit, delete and **export** their data in the app | UI check | P6 / P7 |
| V-13 | Policy changes are announced on the page (and in the app if built) | Process check | P7 |
| V-14 | The Firebase **JS** SDK sends only what the Data safety form declares; read Play's IP-address FAQ in the console | Network capture with a proxy | P7 |
| V-15 | No `AD_ID` permission in the merged Android manifest | Inspect the built AAB | P7 |
| V-16 | Apple label: Audio Data linked or not linked | Depends on `FILE_SYNC` | P7 |
| V-17 | Apple privacy manifest (`PrivacyInfo.xcprivacy`) and required-reason APIs match current rules | Read Apple's current docs; inspect the EAS build | P7 |
| V-18 | What Apple's 13+ override shows on devices with older iOS versions | App Store Connect | P8 |
| V-19 | IARC wording on "users interact or exchange content" vs the export share sheet | Play Console questionnaire | P7 |
| V-20 | Every feature in the store descriptions and screenshots exists in the build | Compare with the build | P7 |
| V-21 | Current screenshot sizes and counts for Play and Apple | Store spec pages | P7 |

## §3 Changes needed in other tracks (sent to the Lead; Track C doesn't edit code)

| To | Change | Why |
|---|---|---|
| P2b | Erase note content when tombstoning, or hard-delete tombstones promptly | Needed for the "deleted from the cloud" claims (`V-7`); Play's partial-deletion answer depends on it |
| P2b | Clear Firebase Auth `displayName` and `photoURL` after Google/Apple sign-in (or decide to declare Name) | Data minimization (`V-5`) |
| P2b | Revoke Sign in with Apple tokens on account deletion | Apple requirement (already passed on by the Lead) |
| P2b | Links to the privacy policy, terms and deletion page on the Me screen | Both stores require an in-app privacy policy link (already passed on) |
| P3b | Birth-year prompt with no default; neutral wording; birth year stored only on the device | Decision Q6 A; Google's neutral age screen guidance (`V-4`) |
| P3b | Explicit per-provider consent before the first send | Apple 5.1.2(i) (already passed on) |
| P3a | Mistral opt-out path: Admin panel → Privacy → "Anonymous improvement data" | Mistral help article dated 2026-09-03 (already passed on) |
| P1 | Links in notes open in the system browser | Avoids Apple's 16+ "unrestricted web access" (already passed on) |
| P4c | Review log `device` = random per-install label | `V-6` |
