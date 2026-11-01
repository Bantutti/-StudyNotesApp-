# Age ratings: IARC (Google Play) and Apple

> **DRAFT. Not legal advice.** Goal (decision Q7 A): the app is for **13 and up**; AI features are **18+ only**, behind a self-declared birth year (decision Q6 A). Re-check at P7.
>
> **Sources (read 2026-11-01):** [Play content ratings](https://support.google.com/googleplay/android-developer/answer/9898843), [Play target audience](https://support.google.com/googleplay/android-developer/answer/9867159), [Apple age rating values](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions), [Apple: set an age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) 2.3.6 and 2.3.8, [Play: US state age laws](https://support.google.com/googleplay/android-developer/answer/16569691).

## §0 How "13+" actually works in each store

- **Neither store lets you pick a rating directly.** Both calculate it from a questionnaire about the app's own content. A notes app with no violence, gambling or mature content will most likely be rated for **everyone** (Play) and **4+** (Apple).
- **Google Play:** "13+" is set by the **target audience** (13–15, 16–17, 18+), not by IARC (`PLAY_APP_CONTENT.md` §2). The IARC rating can stay "Everyone"; that's normal and honest.
- **Apple:** our Terms of Use set a minimum age of 13, and Apple says: *"If your app has a EULA with minimum age requirements that exceed the rating that Apple calculated, you must override to a rating that adheres to the requirements."* So we answer honestly and then choose **Override to Higher Age Rating → 13+**.
- **What is rated:** the app's own content. Students' private notes aren't shared with anyone, so they aren't "user-generated content" in the stores' sense. AI output is the user's own notes rewritten, shown only to them.
- **Honesty rule:** both stores punish misrepresentation (Play: *"Misrepresentation of your app's content may result in removal or suspension"*; Apple 2.3.6: answer *"honestly"*). Answers below describe the app as built; re-answer if features change.

## §1 IARC questionnaire (Play Console → App content → Content rating)

The exact questions appear only inside Play Console after you enter an email address for the IARC certificate. This is a copy-along sheet by topic. **If a question isn't covered here, or the wording suggests a different answer, stop and ask** rather than guess.

| Topic (expected question) | Answer | Reasoning |
|---|---|---|
| App category | The closest to **"Reference, news or educational"** (otherwise "All other app types") | A study and notes tool |
| Violence (any kind, including cartoon or fantasy) | **No** | None in the app's content |
| Fear or horror | **No** | |
| Sexuality, nudity, suggestive content | **No** | |
| Gambling, simulated gambling, loot boxes | **No** | No contests, leaderboards or rewards for money |
| Offensive language, crude humor | **No** | The app's own text and bundled packs contain none |
| Drugs, alcohol, tobacco | **No** | |
| Can users interact or exchange content with each other (chat, voice, sharing images or audio)? | **No** | There's no sharing between users. Exporting a note through the phone's share sheet is the user sending a file with another app, not an in-app exchange (`V-19`) |
| Does the app share the user's current physical location with other users? | **No** | No location access at all |
| Can users buy digital goods? | **No** | Free, no in-app purchases |
| Unrestricted internet access (a browser inside the app)? | **No**, provided links in notes open in the phone's own browser (flagged for P1) | If an in-app browser is ever added, this becomes Yes |
| (If asked) Does the app generate content with AI? | **Yes, text only**: it rewrites, summarizes and makes flashcards from the user's own notes, shown only to that user, for users who enter an 18+ birth year | Answer factually; don't omit it |
| (If asked) Does the app contain ads? | **No** | |

**Expected result:** the lowest rating in each region (for example "Everyone" or "PEGI 3"). You get the certificate by email; if you disagree, appeal through the link in that email.

## §2 Apple age rating questionnaire (App Store Connect → App Information → Age Rating)

Categories as listed on Apple's page today (rules for devices on iOS 26 and later):

| Category → item | Answer | Note |
|---|---|---|
| In-App Controls → Parental Controls | **No** | |
| In-App Controls → Age Assurance | **No** | Our birth-year prompt is **self-declared**, not verified (decision Q6), so claiming age assurance would overclaim |
| Capabilities → Unrestricted Web Access | **No** | Links must open in the system browser; an in-app browser would raise the rating to **16+** |
| Capabilities → User-Generated Content | **No** | No broad distribution of user content (Apple: *"broad distribution of content created by users"*) |
| Capabilities → Social Media | **No** | |
| Capabilities → Messaging and Chat | **No** | |
| Capabilities → Advertising | **No** | |
| Mature Themes → Profanity or Crude Humor; Horror/Fear; Alcohol, Tobacco or Drug Use | **None** | |
| Medical or Wellness → Medical or Treatment Information; Health or Wellness Topics | **None** | |
| Sexuality or Nudity → Mature or Suggestive Themes; Sexual Content or Nudity; Graphic Sexual Content | **None** | |
| Violence → Cartoon or Fantasy; Realistic; Prolonged Graphic or Sadistic; Guns or Other Weapons | **None** | |
| Chance-Based Activities → Gambling; Simulated Gambling; Contests; Loot Boxes | **None** | |

**Expected calculated rating:** **4+**. Then:

1. Under **Age Categories and Override**, choose **Override to Higher Age Rating → 13+** (required because the Terms set 13 as the minimum).
2. Do **not** choose "Made for Kids" (that's for the Kids category and can't be undone after approval).
3. **Age Suitability URL** (optional): `{{SITE_BASE_URL}}/terms.html` (section 1 states the age rules).
4. Apple shows separate ratings for devices on older iOS versions (4+, 9+, 12+, 17+). Check what the 13+ override displays there when filling the form (`V-18`).

**Metadata rule (2.3.8):** icons, screenshots and previews must suit **4+** even though the app is 13+, and "For Kids" or "For Children" may not appear anywhere in the name, subtitle or description.

## §3 The AI 18+ gate: how it's described to the stores

Decision Q6 A (Nov 1, 2026): a **birth year prompt with no default**, replacing the earlier "I'm 18 or older" checkbox. This follows Google's description of a neutral age screen (*"a system that asks users to freely enter their month, day, and year of birth"*, not one that *"indicat[es] that a certain age is required"*).

| Where | What we say |
|---|---|
| Store descriptions (`STORE_LISTING.md`) | "AI features are optional, need your own free Groq or Mistral key, and are for ages 18+." |
| Play "App access" and Apple "App Review notes" | How the gate works and how to pass it for review (`PLAY_APP_CONTENT.md` §3) |
| Apple Age Assurance | **No** (self-declared) |
| Privacy policy §4, Terms §1 and §3 | The 18+ rule, why it exists (the providers' own terms) and what under-18s still get |

**Design notes for P3b (from today's sources, passed on through the Lead):**
- Ask for the year with an empty field or picker and **no pre-filled year**. Don't say "you must be 18" **on the prompt itself**; explain the rule only after the answer (Google's neutral-screen guidance).
- Store the birth year **only on the device** (inventory D6), never in synced settings.
- If the year shows under 18: keep AI off, show what still works (Beautify Lite, rule-based cards), and don't let the user simply retry with a different year in the same session (`L-4`).
- **US state laws:** Google's page (read today) says Texas SB 2420 *"is now in effect"*, and similar laws are coming. Google offers the Play Age Signals API (beta); Apple offers Declared Age Range. We launch in the Philippines first (Q10 A), so these aren't built now; revisit before any US release (`L-18`).
