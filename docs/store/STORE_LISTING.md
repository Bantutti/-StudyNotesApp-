# Store listing drafts

> **DRAFT.** Working name **"Noted"** (decision Q5), kept in the placeholder `{{APP_NAME}}` so a rename is one line in `web/site.config.json`. **Rey is confirming the name; the check below found serious clashes.** Feature claims follow the v1 scope in plan v0.2 and **must be trimmed at P7 to what the beta really does** (`V-20`). Limits checked 2026-11-01 on [Play: Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152), [Apple: App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information) and [Apple: Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information).

## §1 Name check (store search only, **not** a trademark search)

Searched both stores on 2026-11-01 for the working name and three alternatives.

| Name | Google Play | App Store | Verdict |
|---|---|---|---|
| **Noted** | **Taken, same niche.** "Noted." by **Digital Workroom Ltd** (`com.digitalworkroom.noted`): timestamped audio notes for lectures and meetings. Also "Noted - Notes and Todos" (Phoenixstudio), "Noted - Note-taking & To-do" (Partner Codes), "Noted" (Deyvid Andrade), "Noted! - Simplest Note Taking" (DevFaizan) | **Taken, same niche.** "Noted: Record & AI Transcribe" by Digital Workroom Ltd: an **Editors' Choice** study and meeting app whose headline feature is notes time-stamped to a recording, exactly like our planned audio-synced notes (P4). Its website claims **5 million downloads**. Also "Noted." by Parth Antala | **Not recommended.** Apple allows a name only once per localization (*"You can use an app name for one app per localization"*) and advises *"Avoid names that… are too similar to existing app names."* Digital Workroom could also make a trademark claim (Apple has a claim process). On both stores our app would be hard to find under its own name |
| **Studyleaf** | No exact match found (similar: "Studley: AI Study Tutor", "Studiely") | No exact match found (similar: "Studley", "MemoLeaf") | **Looks available**, distinctive |
| **Notelore** | No exact match found (similar: "Notely", "Notewise") | No exact match found (similar: "Notely", "Notelix") | **Looks available**, but close to the crowded "Not-ely" family |
| **Inkwise** | **Taken**: "InkWise - PKM", a notes app (also "Fiery InkWise", a print tool) | "Fiery InkWise" | Not recommended |

**Recommendation:** pick a distinctive name before the package name is fixed (it's permanent on Play). **Studyleaf** is the strongest of the names checked. If Rey prefers to keep "Noted", a qualified name (for example "Noted Study Pages") still sits next to an Editors' Choice app with the same core feature. Whatever is chosen, run a trademark search before launch (`L-19`).

**Searches used:** Exa web search restricted to `apps.apple.com`, `play.google.com` and `notedapp.io`, 2026-11-01. Store search results vary by country; repeat the search in the Play Store and App Store apps on a Philippine account before deciding.

## §2 Google Play listing

| Field | Limit | Draft |
|---|---|---|
| App name | 30 | `{{APP_NAME}}` (e.g. "Studyleaf: Study Notes", 22) |
| Short description | 80 | **Aesthetic study notes that become flashcards. Offline, no account needed.** (73) |
| Full description | 4,000 | below |

**Full description (draft, about 1,700 characters):**

> Make notes you actually enjoy studying from.
>
> {{APP_NAME}} turns your class notes into clean, beautiful study pages, like handwritten notes with highlights, definition boxes and tidy headings, then turns them into flashcards so you remember them on exam day.
>
> START IN SECONDS
> • No account and no sign-up. Pick a look and write your first note.
> • Everything works offline. Your notes are saved on your phone.
>
> NOTES THAT LOOK GOOD
> • Style packs: pastel highlights, minimal, academia, dark mode and an easy-to-read pack.
> • Subjects, folders and templates such as Cornell notes and Q&A.
> • Beautify Lite tidies messy notes into headings, lists and definition boxes, right on your phone.
>
> REMEMBER MORE
> • Make flashcards from your definitions and highlights.
> • Spaced repetition schedules reviews around your exam dates.
> • Quiz yourself before the test.
>
> RECORD AND DRAW
> • Record a lecture while you type; tap a line to hear that moment again.
> • Draw and write with a stylus or your finger.
>
> EXPORT AND PRINT
> • PDF and print that match what you see, and editable Word (DOCX) files.
>
> OPTIONAL EXTRAS
> • Sync between your devices with a free account.
> • AI tools (summarize, explain, make flashcards) using your own free Groq or Mistral key. AI is optional and for ages 18 and up. Your key stays on your phone, and your notes go straight to the AI service you choose, never through our servers.
>
> PRIVATE BY DESIGN
> • No ads. No tracking. We don't sell your data.
> • Delete your account and synced data at any time.
>
> Privacy policy: {{SITE_BASE_URL}}/privacy.html

Writing rules: no keyword stuffing (Play warns that *"repetitive or irrelevant keyword usage… can result in app suspension"*), no claims about other apps, and no feature the beta doesn't have.

## §3 App Store listing

| Field | Limit | Draft |
|---|---|---|
| Name | 2–30 | `{{APP_NAME}}` |
| Subtitle | 30 | **Aesthetic notes & flashcards** (28) |
| Promotional text | 170 | **Write notes that look like beautiful handwritten study pages, then review them as flashcards before your exams. Works offline, no account needed.** (145) |
| Keywords | 100 bytes | `study,notes,flashcards,aesthetic,handwritten,review,exam,lecture,cornell,student,spaced repetition` (98 bytes). Apple: don't repeat the app or company name, and *"names of other apps or companies aren't allowed"* |
| Description | 4,000 | Same as the Play full description (plain text, no HTML) |
| Support URL | — | `{{SITE_BASE_URL}}/support.html` |
| Marketing URL | — | `{{SITE_BASE_URL}}/index.html` |
| Privacy Policy URL | — | `{{SITE_BASE_URL}}/privacy.html` |
| Copyright | — | `2026 {{DEVELOPER_LEGAL_NAME}}` (Apple adds the © symbol) |
| Category | — | Primary **Education**, secondary **Productivity** |
| Seller name | — | Rey's **legal name** is shown as the seller for individual accounts (Apple enrollment page) |

## §4 Screenshot shot list

Screenshot sizes and counts change; check the current Play and Apple specification pages when capturing (`V-21`). Rules that apply now:
- Apple 2.3.8: screenshots must suit **4+** even though the app is 13+, and no "For Kids".
- Play: the app doesn't target under-13s, so avoid *"youthful animation or young characters"*. Keep the **Kawaii Pop** and **Coquette** packs out of the hero shots (they can appear small in the pack grid).
- Use **made-up study content written for the screenshots** (no real classmates' names, no copied textbook pages), and only features that exist in the beta.

| # | Screen | Pack | Content idea | Caption |
|---|---|---|---|---|
| 1 | Editor, a finished note | **Pastel Highlight** (default) | "Biology: The Cell": headings, two definition boxes, highlights | Notes you'll actually enjoy studying |
| 2 | Welcome, pick a look | Pack grid | 6 launch packs: Pastel Highlight, Clear Read, Seoul Minimal, Light Academia, Dark Academia, Color Code | Pick your look in seconds |
| 3 | Review session | Light Academia | A flashcard mid-flip with rating buttons, "12 due today" | Turn notes into flashcards |
| 4 | Home | Seoul Minimal | Due today, exam countdown "Chem midterm in 5 days" | Review before every exam |
| 5 | Beautify Lite before and after | Color Code | Messy typed lines next to the tidy result | Messy notes, tidied up |
| 6 | Lecture note with timestamps (only if P4 is in the beta) | Clear Read | Typed lines with time chips and the audio bar | Tap a line to replay the lecture |
| 7 | Dark mode | Dark Academia or Blackout Gel | History essay outline | Study late, easy on the eyes |
| 8 | Tablet with stylus ink (only if P4b is in the beta) | Cottagecore | Diagram drawn over a note | Write and draw by hand |

Optional Play feature graphic (1024×500): the note from shot 1 at an angle on a soft paper background, name and subtitle beside it.

## §5 Before submitting

- [ ] Final name chosen; trademark search done (`L-19`)
- [ ] Every feature in the descriptions and screenshots exists in the submitted build (`V-20`)
- [ ] URLs live on GitHub Pages and the placeholders filled
- [ ] Data safety, privacy labels and age ratings match `docs/store/` and the build
