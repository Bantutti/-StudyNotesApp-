# Google Play: App content page and store settings

> **DRAFT. Not legal advice.** Proposed answers for the "App content" declarations in Play Console, other than Data safety (`PLAY_DATA_SAFETY.md`) and content rating (`AGE_RATINGS.md`). Play's exact list depends on the app; answer the ones Play shows. **The closed test can't start until app setup is complete** (Play: *"You can start a closed test after completing your app setup"*, [testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465), read 2026-11-01), so these are on the critical path for P7.

## §1 Creating the app (Play Console → Create app)

Source: [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152), read 2026-11-01.

| Field | Proposed value | Notes |
|---|---|---|
| App name | `{{APP_NAME}}` (30 characters max) | "Noted" is a working name and **clashes**, see `STORE_LISTING.md` §1. Can be changed later |
| Package name | **Not chosen yet** (decision Q5) | **Permanent**: *"Package names for app files are unique and permanent… can't be deleted or re-used."* Choose only after the final name |
| Default language | English (United States), en-US | Play's automatic translation doesn't support Tagalog |
| App or game | App | |
| Free or paid | Free | |
| Contact email (shown publicly) | `{{CONTACT_EMAIL}}` | Required; shown on the listing |

## §2 App content declarations

| Declaration | Proposed answer | Reason |
|---|---|---|
| **Privacy policy** | `{{SITE_BASE_URL}}/privacy.html` | Play policy: public, not geofenced, not a PDF, not editable, names the developer or app, has a privacy contact. Our page meets these once placeholders are filled |
| **App access** | **Some functionality is restricted**: give instructions (§3) | AI features need the user's own key and a birth year of 18+ |
| **Ads** | **No, my app does not contain ads** | No ad SDKs (inventory §3) |
| **Content rating** | IARC questionnaire, see `AGE_RATINGS.md` §1 | |
| **Target audience and content** | Ages **13–15, 16–17, 18 and over** (decision Q7 A). Do **not** select any under-13 group | Leaving out the under-13 groups keeps the app out of the Families policy. Google notes 13–15 *"may be considered to include children in some locales"* (`L-10`) |
| Appeal to children (asked under Target audience) | The app and listing are **not** designed to appeal to children under 13 | Keep the screenshots "study" rather than "cute" (see `STORE_LISTING.md` §4); Google may reject listings with *"youthful animation or young characters"* when under-13 isn't targeted |
| **Data safety** | See `PLAY_DATA_SAFETY.md` | |
| **Advertising ID** | **No**, the app doesn't use the advertising ID | P7 checks that the merged Android manifest has no `AD_ID` permission (`V-15`) |
| News app | No | |
| Health apps / health features | No | |
| Financial features | None | |
| Government app | No | |

## §3 App access instructions (text to paste)

> {{APP_NAME}} works without an account or login. All note-taking, styling, flashcard and review features are available immediately.
>
> AI features are optional and need the user's own free API key from Groq (console.groq.com) or Mistral. The first time you open an AI feature, the app asks for a birth year; enter any year that makes you 18 or older, because AI is limited to adults. Then paste a Groq key and tap Test key.
>
> [Only if Rey decides to provide one, see REY_SETUP.md §9:] A test key for review is available at: …
>
> Sync is optional: tap Me → Sync and create an account with any email address.

## §4 Store settings

| Field | Proposed value |
|---|---|
| Category | **Education** (alternative: Productivity). The app is built around studying and review |
| Tags | Notes, Study, Flashcards (pick from Play's list) |
| Contact email | `{{CONTACT_EMAIL}}` |
| Website | `{{SITE_BASE_URL}}/index.html` |
| Phone | Leave empty (optional) |
| Countries | **Philippines** for the closed test and launch (decision Q10 A); add more later after the legal review |
