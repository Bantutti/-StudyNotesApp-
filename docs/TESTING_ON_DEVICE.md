# Testing on your own phone or tablet

This guide is for testing on real devices from a **Windows PC with no Mac**. Follow it top to bottom
the first time. Commands go in **PowerShell** or **Command Prompt** opened in the project folder.

> Phase covered: **P1 core app** (the real offline app), plus the **P0 spike lab** (now in the hidden
> developer menu), the **P2a backend** rules tests and the **P3a AI engine** tests. Updated every phase.
> Nothing in this guide publishes anything: no store uploads, no public website.

---

## 1. Prerequisites

| What | Why | Cost |
|---|---|---|
| **Node.js 24 LTS** from https://nodejs.org (choose "LTS", version 24.x) | Runs the dev server. npm 11 is included. | Free |
| **Git for Windows** from https://git-scm.com (optional) | Version control | Free |
| **Expo Go** app on your phone (Play Store / App Store) | Runs the app without building it | Free |
| **Expo account** at https://expo.dev/signup | Only for an installable Android APK (section 4c) or the development build (section 4b) | Free plan is enough |
| **Groq account** at https://console.groq.com | Only for the audio timestamps spike and the AI live check (section 7). AI features are 18+ only. | Free plan, no card |
| **Mistral account** at https://console.mistral.ai | Optional second AI provider for the AI live check (section 7) | Free mode, no card |
| **Java JDK 21+**: `winget install EclipseAdoptium.Temurin.21.JDK` | Only to run the backend (Firebase rules) tests on your PC (section 6) | Free |
| Apple Developer Program | Only for an iPhone development build. **Not needed for P1** (everything in P1 runs in Expo Go). | Paid (99 USD/year) |
| Firebase project | **Not needed.** The backend tests use local emulators (section 6). A real project comes later, only with your approval (Storage needs the paid Blaze plan). | Not needed |

Upgrading Groq or Mistral to a paid plan costs money; the app never needs that.

Check Node after installing (close and reopen the terminal first):

```powershell
node -v      # must print v24.x.x
npm -v       # prints 11.x.x
```

> If `node -v` shows another major version (for example v22), the project will refuse to install.
> Install Node 24 LTS and reopen the terminal.

## 2. Setup

1. Unzip `StudyNotesApp-P1-core-app-<date>.zip` to a short path, for example `C:\dev\StudyNotesApp`
   (long paths inside `Downloads` can break Windows tools).
2. Open a terminal in that folder:
   ```powershell
   cd C:\dev\StudyNotesApp
   ```
3. Install the exact dependency versions from the lockfile:
   ```powershell
   npm ci
   ```
   This takes a few minutes. Warnings about "install-scripts" are expected: npm 11 blocks
   third-party install scripts by default and the project does not need them.
4. Create your local environment file (the app needs **no secrets**, but keep the habit):
   ```powershell
   copy .env.example .env
   ```
   **Never commit `.env` and never put keys in it for this app.** Your Groq key goes into the app on
   your phone (section 7), not into any file.
5. Optional sanity check (runs every automated check, about 1 minute):
   ```powershell
   npm run verify
   ```
   Expected: it ends without errors and shows `Tests: … passed`.
6. Start the dev server for Expo Go:
   ```powershell
   npm run start:go
   ```
   A QR code appears in the terminal. Leave this window open while testing.

> Use `npm run start:go`, not plain `npx expo start`. The project includes the development-build
> client, so plain `expo start` would wait for a development build instead of Expo Go.

## 3. Android phone (Expo Go)

1. Install **Expo Go** from the Play Store.
2. Connect the phone to the **same Wi-Fi** as the PC (not a guest network).
3. Open Expo Go and tap **Scan QR code**, then scan the QR code in the terminal.
4. The first load bundles the app (up to a minute). You should see the **Welcome** screen (first run)
   or **Home**.

**Windows Firewall:** the first time, Windows asks whether Node.js may use the network. Tick
**Private networks** and click **Allow**. If you clicked Cancel: Windows Security > Firewall &
network protection > Allow an app through firewall > Change settings > tick Node.js for Private.

**If the phone cannot connect (network problems):** use tunnel mode, which works across
networks and some school/office Wi-Fi:

```powershell
npm run start:go:tunnel
```

The first time, it may ask to install `@expo/ngrok`; answer **Y**.

**USB option (Android only):** if Wi-Fi is unreliable, use a cable.
1. Phone: Settings > About phone > tap **Build number** 7 times to enable Developer options.
2. Settings > Developer options > turn on **USB debugging**.
3. Install the Android platform tools on the PC: https://developer.android.com/tools/releases/platform-tools
   (unzip, for example to `C:\platform-tools`).
4. Plug in the phone, accept the "Allow USB debugging" prompt, then run:
   ```powershell
   C:\platform-tools\adb devices          # your phone should be listed as "device"
   C:\platform-tools\adb reverse tcp:8081 tcp:8081
   ```
5. In Expo Go, scan the QR code again (or type `exp://127.0.0.1:8081` under "Enter URL manually").

## 4. iPhone (Expo Go)

1. Install **Expo Go** from the App Store. **No Mac and no paid Apple account are needed** for this.
2. Same Wi-Fi as the PC (or use tunnel mode from section 3).
3. Open the iPhone **Camera** app, point it at the QR code, and tap the banner to open in Expo Go.
4. Allow "Local Network" access if iOS asks (Settings > Privacy & Security > Local Network > Expo Go).

**What works on iPhone with Expo Go:** all of P1 (notes, editor, subjects, templates, Beautify, history,
styles, search), and in the developer menu the P0 editor, export, FSRS, audio timestamps and ink spikes.
**What does not:** the P0 90-minute **background** recording spike. In Expo Go, recording stops when the
screen locks. A background-capable iPhone build needs an EAS development build signed with a paid
Apple Developer account. You chose Android-only for now, so this spike runs on Android only.
The screen shows a yellow banner explaining this.

### 4b. Android development build (needed for the 90-minute background recording)

This builds a real installable app (APK) in the cloud. Free Expo account, no Android Studio needed.

1. Log in once:
   ```powershell
   npx eas-cli@latest login
   ```
2. Link the project to your Expo account (first time only; accept the prompts):
   ```powershell
   npx eas-cli@latest init
   ```
3. Start the build (10 to 20 minutes, runs on Expo's servers):
   ```powershell
   npm run build:android:dev
   ```
   If it asks to create an Android keystore, answer **Yes** (Expo stores it for you; never put
   keystores in the project folder).
4. When it finishes, open the build link on your Android phone (or scan the QR code it prints),
   download the APK and install it. Android will ask to allow installs from your browser:
   allow it for this install only.
5. Start the dev server for the development build:
   ```powershell
   npm run start:dev
   ```
6. Open the new **Study Notes** app on the phone (not Expo Go). It finds the server
   on the same Wi-Fi, or scan the QR code from inside the app.

> Phases that need a development build: **P0 recording spike** (background), **P2** if
> native Firebase modules are added, and likely **P4** (voice) and **P4b** (ink tuning).
> Rebuild only when native dependencies or `app.json` plugins change; JavaScript changes reload
> instantly.

### 4c. Install the app on Android as an APK (no dev server needed)

This builds a normal installable app (like one from a store, but only for you). It runs without the
PC. Free Expo account; the build runs on Expo's servers; no Android Studio needed.

1. Log in and link the project (first time only, same as 4b steps 1 and 2):
   ```powershell
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```
2. Build the APK with the `preview` profile (10 to 20 minutes):
   ```powershell
   npx eas-cli@latest build --profile preview --platform android
   ```
   If it asks to create an Android keystore, answer **Yes** (Expo keeps it; never put keystores in the
   project folder).
3. Open the link it prints on your Android phone, download the APK and install it (allow installs from
   your browser for this install only).
4. Open **Study Notes**. Everything in section 8 "P1" works offline in this build.

> The app name and Android package id are still placeholders (`Study Notes`, `com.reyanyan.studynotes.dev`).
> The final name ("notedpo") is set once the store-name check is done. An APK built now installs next to
> later builds only if the package id stays the same.
>
> The 6 app icons in `assets/` are in this zip but not in GitHub (the integration can't upload images).
> If you build from a GitHub checkout, copy them in from the zip first.

## 5. Tablet and stylus testing

Use an Android tablet with a stylus if you have one (Samsung Tab with S Pen, Lenovo with pen,
or an iPad with Apple Pencil in Expo Go).

1. Open **6. Ink latency**.
2. **Palm rejection = Auto:** write 3 lines of real notes with the pen while resting your palm on
   the screen as you normally would.
   - Watch for: stray marks under your palm, missing pen strokes, lines starting late.
   - Expected: palm makes no marks once the pen has touched the screen. "Rejected" counts palm touches.
   - Known P0 limit: if your palm touches **before** the pen, the pen stroke may not start. Note how
     often this happens; it decides how much work P4b needs.
3. Switch to **Stylus only** and repeat: fingers must never draw.
4. Switch to **Off** and draw with a finger: it should draw.
5. Watch the numbers: **Frame p50/p95** (lower is smoother; about 8 ms on 120 Hz screens, 16 ms on
   60 Hz), **Dropped** (aim for under 5%), **Samples/s** (how often the pen reports; 120+ is good).
6. **Real touch-to-ink latency (optional, most accurate):** record the screen with another phone in
   **slow motion (240 fps)** while drawing fast. Count frames between the pen tip moving and ink
   appearing; frames ÷ 240 = latency in seconds (8 frames ≈ 33 ms). Note it in your report.
7. Rotate the tablet: the canvas should resize and keep working.
8. Tap **Save result**.

**Editor on a tablet (P1):** open a note in portrait and landscape. The page and the keyboard toolbar
should use the full width; the slash menu and block picker should stay inside the page.

Layout check on the tablet: open every spike in portrait and landscape. Nothing should be cut off,
and buttons should stay at least finger-sized.

## 6. Safe test backend

**The app has no online backend yet** (accounts and sync come in P2b). P1 stores everything on the phone:
- notes, subjects, folders, versions and settings in a SQLite database in the app's private storage,
- (developer menu) P0 results log, recordings and the Groq test key.

**Me > Delete all data** removes all of it (database file, recordings, results log and the test key) and
returns to Welcome. Uninstalling the app (or Expo Go) also deletes everything.

**Backend rules tests (P2a), on your PC, never on production data.** The Firebase backend lives in
`firebase/` as its own npm project and runs only against local emulators (project `demo-studynotes`, no
account, nothing online). It needs Java 21+ (section 1):

```powershell
cd firebase
npm ci
npm test
```

Expected: about 600 tests pass (601 at the P2a merge). Full guide, including a visual demo with the
emulator UI at http://127.0.0.1:4000: `docs/backend/TESTING_BACKEND.md`.

To connect a **phone** to the emulators later (P2b), the emulators must listen on your PC's Wi-Fi address
instead of 127.0.0.1. Only do that on a private home Wi-Fi, allow Java through Windows Firewall for
**Private** networks only, and never on public Wi-Fi. P2b adds those steps with the sync module.

## 7. AI features

AI features are **18+ only** and need your own free key. P1 has **no AI screens** (they come in P3b);
the app works fully without a key (Beautify Lite runs on the phone).

**Groq key for the P0 audio timestamps spike** (developer menu):
1. Go to https://console.groq.com and sign in (free plan).
2. Open **API Keys** > **Create API Key**, name it `study-notes-test`, and copy the key (starts with `gsk_`).
3. In the app: Me > tap the version 7 times > **Developer menu** > **AI key** > paste > **Save key** >
   **Test key**. Expected: "Key works." The screen then shows only a masked version like `gsk_…3fQa`.
4. **Never share the key, never paste it into chats or issues, never commit it or put it in `.env`.** If
   you think it leaked, delete it in the Groq console and create a new one.
5. To remove it: the same screen > **Delete** (or Me > Delete all data).

**AI engine live check (P3a), on your PC.** The engine is tested with your own keys from a terminal; the
key is typed into a masked prompt and never saved. Steps are in `docs/modules/ai.md` ("Live check").
For **Mistral**, first open its Admin panel > **Privacy** (left-hand menu) and switch off **"Anonymous
improvement data"** before using it with your notes. It is separate from the Vibe toggle (Mistral Help
Center, Sep 3, 2026).

## 8. Phase test checklist (cumulative)

Write PASS / FAIL and any numbers next to each step. Then open **Results log** > **Copy all as
Markdown** and paste it back to me with your notes.

### P1: core app

Use Expo Go (sections 3 and 4) or the APK (4c). Write PASS / FAIL and notes next to each step.

**First run and look**
1. Fresh start: Me > **Delete all data** (or a fresh install). *Expected:* the **Welcome** cards appear.
   No sign-in, AI key, microphone or notification prompt appears anywhere in steps 1 to 3.
2. Swipe the 3 cards (or tap Next), then **Pick your look**. *Expected:* two real pages: **Pastel
   Highlight** (lined paper, pink header swipe) and **Clear Read** (plain warm paper, large Atkinson
   Hyperlegible font). Tap one; a check mark shows.
3. **Add your first subject:** type "Biology", pick a colour, optionally an exam date like
   `2026-12-15`, tap **Create subject**. *Expected:* the **Sample note** opens in your chosen look, labelled
   Sample, inside Biology.
4. **Timed first note (exit criterion, target under 60 seconds):** Delete all data again. Start a
   stopwatch when you open the app. Go through Welcome, Pick your look and the subject, then tap the
   **+** tab > **New note**, type one line, and stop the watch. Write the time down.
5. **Skip path:** Delete all data, then tap **Skip** on Welcome. *Expected:* an empty Home with a
   "Create your first note" card.

**Writing (the editor)**
6. In a note, type a few paragraphs and press Enter between them. Use the toolbar: **Aa** > H1, H2, B, I,
   U, S; the **highlighter** button > each colour (names like "Key idea" show under each); the **list**
   button > bullets, numbers, quote, callout; **Undo** and **Redo**. *Expected:* each applies at once.
7. **Autosave:** type a sentence, wait 2 seconds, swipe the app away (close it fully), reopen and open the
   note. *Expected:* the sentence is there. There is no Save button.
8. **Typing shortcuts:** on new lines type `# Title`, `- point`, `1. step`, `> a quote`, `---`, and
   `see ==this== word`. Then type `Osmosis :: water moves across a membrane` and press Enter at the end.
   *Expected:* a title, a bullet, a numbered item, a quote, a divider, a highlight, and a **definition box**
   titled "Osmosis".
9. **Enter at the start of a line:** put the cursor at the very start of a line with text and press Enter.
   *Expected:* an empty line appears **above**; the text stays where it was.
10. **Slash menu:** on an empty line type `/`. *Expected:* a menu with small previews in the note's look.
    Type `cal` and tap **Callout**. Try `/table`, `/cornell`, `/q&a`.
11. **+ block** (toolbar): insert a **Q&A** (Enter in the question jumps to the answer), **Two columns**,
    **Cornell**, **Table** (inside the table use + Row, + Column, − Row; a table stops at 12 columns) and a
    **Summary**.
12. **Block menu** (toolbar ≡ button): **Move up**, **Move down**, **Duplicate**, **Turn into > Heading**,
    **Delete block**. *Expected:* each works and the note stays tidy.
13. **Info** (ⓘ in the top bar): word count and the outline of headings; tap a heading to jump to it.
14. **Focus mode** (below the page): title and modes hide; tap again to show them.

**Shaping**
15. **Beautify:** make a new note with these lines:
    `CELL BIOLOGY` / `Membranes:` / `Osmosis :: water moves` / `- passive` / `- no ATP` / `Q: What is ATP?` /
    `A: energy` / `Tip: revise this`. Tap **Beautify** in the toolbar. *Expected:* headings, a definition box,
    a list, a Q&A block, a callout and a "Key terms" list at the end; your words unchanged. Tap **Undo** in
    the bar at the bottom within 8 seconds. *Expected:* the original lines come back exactly.
16. **Templates:** **+** tab > **From template** > **Cornell**. *Expected:* a title, the date, cue and notes
    columns, a summary box. In a subject: edit subject > "New notes start from" > **Lecture**; new notes in
    that subject start from Lecture.
17. **Style:** in a note tap **Style** > **Clear Read**. *Expected:* the page changes look at once; the
    words don't change. Tap **Use this look for the subject** or **for new notes** to set defaults.
18. **History** (clock icon): versions such as "Before Beautify" and "Before style change". Open one,
    tap **Restore this version**. *Expected:* the text and the look come back; a "Before restore" version is
    added, so you can switch back.

**Finding and organising**
19. **Search:** Home > search bar > type `osmo`. *Expected:* the Sample note, with "Osmosis" highlighted in
    the snippet. Tap it. *Expected:* the note opens scrolled to that line with a short outline flash.
20. **Subjects and folders:** create a subject, a folder inside it, a note inside the folder. Long-press a
    note > move it to another subject. Long-press a subject > Delete > **Move its notes to Inbox**, then tap
    **Undo**. *Expected:* everything is back.
21. **Delete and undo:** delete a note and tap **Undo** within 8 seconds: it is back. Delete it again and
    wait 10 seconds: Undo is gone and search no longer finds it.
22. **Dark mode:** switch the phone to dark mode. *Expected:* the app's menus turn dark; note pages keep
    their look.
23. **Delete all data:** Me > Delete all data. *Expected:* back to Welcome with nothing left.

**Typing diagnostics (please do this; it replaces guessing about keyboards)**
24. Me > tap the version number **7 times** > **Developer menu** > **Typing diagnostics**. For each keyboard
    you have (Gboard, Samsung Keyboard, SwiftKey, the iPhone keyboard): type for about a minute, including a
    long word, an autocorrected word, Enter at the start of a line, a `- ` list and voice typing. Tap
    **Copy log** and paste it into your report with the keyboard's name. The log has no note text, only
    event types and numbers.
25. In a normal note, write down any doubled letters, jumping cursor, lost words or keyboard covering the
    toolbar, with the keyboard name.

**Security checks (P1)**
26. *Links open outside the app:* select a word > **Aa** > link icon > `https://example.com` > **Add link**.
    Tap the link. *Expected:* an "Open link?" dialog showing `example.com`. **Cancel** does nothing; **Open**
    opens your phone's browser as a separate app. Nothing ever loads inside Study Notes.
27. *Pasted content is cleaned:* copy part of a web page with a picture and a link, paste it into a note.
    *Expected:* text and the link stay; the picture doesn't; nothing pops up.
28. *Note text never reaches logs:* while `npm run start:go` runs, write a note titled `SECRETWORD` with
    `SECRETWORD` in the text, and search for it. In the terminal window press **Ctrl+F** and search
    `SECRETWORD`. *Expected:* not found.
29. *Invalid input is rejected:* a subject name of 81 characters, or 41 emoji, is refused with a message (40
    emoji is fine); an exam date `2026-02-30` says "That date does not exist."
30. *Another user's note is not readable:* no accounts exist in P1. Covered by the backend tests (P2a list
    below, item 4).

### P0: spike lab (developer menu)

**Home**
1. Me > tap the version 7 times > **Developer menu (P0 spike lab)**. *Expected:* blue banner saying it
   uses SAMPLE data; your device model and runtime (expo-go or dev-build) are shown; six spike cards.

**1. Editor**
2. Open **Editor spike**. *Expected:* the sample note "Osmosis & Diffusion" appears on lined paper
   with pink header swipe and pastel highlights, labelled SAMPLE NOTE. Boot and Load show numbers.
3. Type a few words, select some text, tap a highlight swatch, then **B** and **H2**. *Expected:*
   formatting applies; "Blocks" changes when you press Enter.
4. Switch the pack to **Dark Academia**. *Expected:* dark paper, gold Cinzel header within about a second.
5. Tap **Measure bridge**. *Expected:* Bridge p50 under 50 ms.
6. Tap **Load long note**. *Expected:* about 400 blocks load; note the Load time.
7. *Security:* copy a paragraph containing a link and an image from any web page and paste it into
   the editor. *Expected:* text and link survive; the image does not appear; nothing pops up.
8. Tap **Save result**.

**2. Export**
9. Open **Export fidelity**. Choose **Pastel Highlight**, paper **A4**. Tap **Export PDF and share**
   and open the PDF in a PDF viewer. *Expected:* Gaegu header and Nunito body fonts, pastel
   highlights, lined paper with margin line, dashed definition box, pink callout bubble.
10. Tap **Export DOCX and share** and open it in Word or Google Docs. *Expected:* same text,
    highlight colours as shaded text, definition box with border. (Word cannot copy CSS effects
    exactly; note what differs.)
11. Tap **Print…**. *Expected:* the system print dialog with the same look in the preview.
12. Repeat 9 with **Dark Academia** and **Letter / short bond**. *Expected:* dark paper fills every page.
13. Tick the checklist honestly and tap **Save result**.

**3. FSRS on this phone**
14. Open **FSRS on this phone**. *Expected:* "JS engine: Hermes".
15. Tap **Run self-test**. *Expected:* Golden steps **8/8**, Merge order **same**, Replay = live **yes**.
16. On the sample card, tap **Good** a few times. *Expected:* the intervals grow; "Reviews logged"
    increases. Tap **Save result**.

**4. 90-minute recording** (Android development build from section 4b)
17. Open **90-min recording**. *Expected:* blue banner "Development build: background recording is enabled".
18. Choose **Speech (32 kbps mono)**, tap **Start recording**, allow the microphone.
    *Expected:* a persistent "Recording audio" notification appears.
19. **Lock the screen** and leave the phone for **90 minutes** (normal use is fine: lecture, desk).
    Note the battery % before you start.
20. Unlock, open the app, tap **Stop**. *Expected:* Coverage **98% or higher**, no long gap,
    "90 min size" **under 25 MB**. Note Battery/hour. Tap **Save result**.
21. *Expo Go check (any phone):* start a 2-minute recording and lock the screen. *Expected:* the
    yellow banner warned you; Stop shows low coverage. This proves the gap detector works.
22. *Security:* deny the microphone permission once (Settings > Apps > Expo Go or Study Notes >
    Permissions > Microphone > Don't allow), then tap Start. *Expected:* a clear message, no crash.

**5. Audio timestamps** (needs a Groq key, section 7)
23. On **90-min recording**, record yourself reading the **English** script (shown on the timestamps
    screen) for 1 to 2 minutes. Stop.
24. Open **Audio timestamps**, pick that recording, script **English**, glossary **On**, tap
    **Transcribe with Groq**. *Expected:* a consent dialog explaining the upload to Groq; after
    Upload, a transcript with WER, words and API time.
25. Tap 5 different words. After each, mark **Started at the word** or **Started early/late**.
    *Expected:* at least 4 of 5 start at the word.
26. Run the **Tap-along drift test** and tap when you hear each word. *Expected:* a steady median
    (often 150 to 350 ms because of reaction time) with a small spread (MAD under 250 ms).
27. Tap **Save result**. Repeat steps 23 to 27 for **Taglish** and **Cebuano-mixed** scripts.
28. *Security:* AI key screen, type `hello` and Save. *Expected:* "That does not look like a Groq key."

**6. Ink latency:** follow section 5, then **Save result**.

**Security checks for this phase**
29. *AI key not in logs:* while `npm run start:go` is running, save and test your key, then run a
    transcription. In the terminal window press **Ctrl+F** (or scroll) and search for `gsk_`.
    *Expected:* not found. Also copy the results log and search the pasted text for `gsk_`: not found.
30. *Results contain no content:* copy the results log. *Expected:* numbers and short summaries
    only, no note text, no transcript words, no file names.
31. *Another user's note is not readable:* **not applicable in P0** (no accounts or cloud). This
    check starts in P2 with Firebase rules tests.
32. *Invalid input rejected:* covered by steps 7, 22 and 28.

### P2a: backend rules (on your PC)

Run section 6 (`cd firebase`, `npm ci`, `npm test`). *Expected:* all tests pass (601 at the P2a merge).
The 22 checks, each mapped to tests (for example **4. Bob reads, updates or deletes Alice's note: denied**;
**11. an oversized title: denied**; **19. account deletion leaves nothing behind**), are listed with
expected results in `docs/backend/TESTING_BACKEND.md` section 5.

### P3a: AI engine (on your PC)

1. `npm run verify` in the project folder. *Expected:* all green (the AI module's 10 live tests are skipped).
2. Live check with your Groq key (`docs/modules/ai.md`, "Live check"). *Expected:* 5 Groq tests pass.
3. Live check with your Mistral key. *Expected:* 5 Mistral tests pass.
4. Live check with no keys. *Expected:* only the "rejects a made-up key" tests run, and they pass.
5. *Security:* search the test output for your key. *Expected:* it does not appear.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| QR code will not scan | Make the terminal window bigger, or in Expo Go use "Enter URL manually" with the `exp://…` address shown under the QR code. On iPhone use the Camera app, not Expo Go's scanner. |
| "Something went wrong" / app stuck on loading | Press `r` in the terminal to reload. If still stuck: stop with Ctrl+C, run `npx expo start --go --clear`. |
| Metro not reachable / "Could not connect to development server" | Same Wi-Fi? Allow Node.js in Windows Firewall (section 3). Try `npm run start:go:tunnel`. On a VPN, turn it off. |
| Expo Go says the project needs a newer SDK | Update Expo Go from the store. The project uses Expo SDK 58. If Expo Go in the store has moved to a newer SDK, tell me: the project needs a short SDK upgrade (or use the APK, section 4c). |
| `npm ci` fails with "Unsupported engine" | Install Node 24 LTS (section 1) and reopen the terminal. |
| `npm ci` fails with EPERM / file locked | Close VS Code and any running `expo start`, then retry. Avoid OneDrive-synced folders. |
| Microphone permission denied | Phone Settings > Apps > Expo Go (or Study Notes) > Permissions > Microphone > Allow. |
| Recording stops when the screen locks | Expected in Expo Go. Use the Android development build (section 4b). |
| Development build cannot find the server | Run `npm run start:dev` (not start:go). Same Wi-Fi, or scan the QR code from inside the dev app. |
| EAS build fails | Run `npx eas-cli@latest whoami` to check login. Copy the build log link and send it to me. |
| Groq: "rejected the key" | Copy the key again (no spaces), save, Test key. Create a new key if it was deleted. |
| Groq: "file is larger than 25 MB" | Use the Speech preset; High quality is about 58 MB per hour. |
| Export share sheet does not open | Some phones need a PDF viewer or Word/Docs installed. Try Print… to check the layout. |
| Fonts look like system fonts in exports | Bundled fonts: Gaegu, Nunito, Cinzel, Crimson Pro and Atkinson Hyperlegible. Other packs' fonts fall back until P5. |
| "Your notes were saved by a newer version of the app" | You opened an older build after a newer one. Install the newest build. Your notes are safe. |
| The keyboard covers the toolbar, or the page jumps while typing (Android) | Known unverified area. Note your phone, Android version and keyboard, then run Typing diagnostics (checklist step 24) and send the log. |
| Doubled letters, lost words or a jumping cursor | Same as above: Typing diagnostics with that keyboard, plus a screen recording if you can. |
| A banner says a change could not be checked and was not saved | Tap Undo in the toolbar, then copy the text into a new note, and send me the steps. |
| Link does nothing when tapped | It asks first ("Open link?"). If no browser is set as default, choose one in Android Settings > Apps > Default apps. |
| Backend tests: `npm : running scripts is disabled on this system` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `npm.cmd`. |
| Backend tests: `firebase-tools no longer supports Java version before 21` / `Could not spawn java -version` | Install Java 21 (section 1), reopen PowerShell, check `java -version`. |
| Backend tests: port already in use / tests time out on the first run | Close other emulator windows; run `npm test` again (the first emulator download can be slow). More rows: `docs/backend/TESTING_BACKEND.md` section 6. |
| AI live check: 401 with your real key | Copy the key again from the provider's key page (no spaces). |
| AI live check: 429 | You used the free limit; wait or try tomorrow. Mistral 400 on Beautify: report it (schema field names). |

## 10. Reporting problems

Send me, in one message:

1. **Device:** model (for example "Samsung Galaxy Tab S9"), OS version (Settings > About), and
   whether you used **Expo Go** or the **development build**.
2. **Which step** of section 8 (number) and what you expected.
3. **What happened instead**, step by step.
4. A **screenshot** or short screen recording.
5. **Console output:** copy the last 30 lines of the terminal running `npm run start:*`.
   **Check it contains no keys** (search for `gsk_`) before pasting.
6. The **Results log** copied as Markdown (Home > Results log > Copy all as Markdown).
