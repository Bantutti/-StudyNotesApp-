# Testing on your own phone or tablet

This guide is for testing on real devices from a **Windows PC with no Mac**. Follow it top to bottom
the first time. Commands go in **PowerShell** or **Command Prompt** opened in the project folder.

> Phase covered: **P2b sign-in and sync** (against the local Firebase emulators), the **P3b AI screens**,
> the **P1 core app**, plus the **P0 spike lab** (now in the hidden developer menu), the **P2a backend**
> rules tests and the **P3a AI engine** tests. Updated every phase.
> Nothing in this guide publishes anything: no store uploads, no public website.

---

## 1. Prerequisites

| What | Why | Cost |
|---|---|---|
| **Node.js 24 LTS** from https://nodejs.org (choose "LTS", version 24.x) | Runs the dev server. npm 11 is included. | Free |
| **Git for Windows** from https://git-scm.com (optional) | Version control | Free |
| **Expo Go** app on your phone (Play Store / App Store) | Runs the app without building it | Free |
| **Expo account** at https://expo.dev/signup | Only for an installable Android APK (section 4c) or the development build (section 4b) | Free plan is enough |
| **Groq account** at https://console.groq.com | Only for AI features in the app (P3b), the audio timestamps spike and the AI live check (section 7). AI features are 18+ only. | Free plan, no card |
| **Mistral account** at https://console.mistral.ai | Optional second AI provider (section 7) | Free mode, no card |
| **Java JDK 21+**: `winget install EclipseAdoptium.Temurin.21.JDK` | Only to run the backend (Firebase rules) tests on your PC (section 6) | Free |
| Apple Developer Program | Only for an iPhone development build. **Not needed for P1** (everything in P1 runs in Expo Go). | Paid (99 USD/year) |
| Firebase project | **Not needed.** Sign-in and sync (P2b) run against the local emulators on your PC (section 6). A real project comes later, only with your approval (Storage needs the paid Blaze plan). | Not needed |
| Google or Apple sign-in | **Not in P2b builds** (the buttons are hidden). Google needs a real Firebase project and a development build; Apple also needs the paid Apple Developer account. Email sign-in works everywhere. | Later decision |

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
The **developer menu exists only in Expo Go (`npm run start:go`) and EAS development builds**, never in
the preview APK or a store build.
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
6. Open the new **NotedPo** app on the phone (not Expo Go). It finds the server
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
4. Open **NotedPo**. Everything in section 8 "P1" works offline in this build, **except the developer
   menu** (Typing diagnostics, the P0 spikes): tapping the version does nothing in the APK, on purpose
   (its test screens send audio without the 18+ check). Do step 24 in Expo Go.

> The APK is **NotedPo** with the final app id `io.github.bantutti.notedpo`, so later builds install as
> updates over this one (your notes stay). If you ever installed an older test build with a different id,
> uninstall it first; it is a separate app.
>
> The 6 app icons in `assets/` are in this zip but not in GitHub (the integration can't upload images).
> If you build from a GitHub checkout, copy them in from the zip first.

## 5. Tablet and stylus testing

Use an Android tablet with a stylus if you have one (Samsung Tab with S Pen, Lenovo with pen,
or an iPad with Apple Pencil in Expo Go). A phone with a finger works for everything except
pen-only checks. **Everything in this section is UNVERIFIED until you run it.**

**A. Drawing in a note (P4b)**

1. Open any note and tap **Draw** (next to Type and Style). The keyboard closes and the drawing
   toolbar appears: at the **bottom** on a phone, as a **floating bar on the side** on a tablet.
2. Write a few words with the pen. Expected: the ink follows the pen with no visible lag and
   doesn't jump or change shape when you lift the pen.
3. **Palm test:** write 10 lines with your palm resting on the screen as you normally would.
   Count marks you didn't mean to make. Once the pen has touched the screen, a finger or palm
   should scroll instead of drawing.
4. **Scroll and zoom:** two fingers scroll the page (it keeps moving a little after a flick);
   pinch zooms up to 3x. Tap **Done**: the zoom resets.
5. Rotate the tablet: the page is a fixed-width column, so your drawing stays over the same words.

**B. Ink diagnostics (developer menu, dev builds only)**

1. Developer menu > **6. Ink diagnostics**.
2. **Live drawing:** choose Palm rejection = Auto and write 3 lines with your palm resting.
   Watch the numbers: **Frame p50/p95** (about 8 ms on 120 Hz screens, 16 ms on 60 Hz),
   **Dropped** (aim under 5%), **Samples/s** (120+ is good), **Palm rejected**.
3. **Latency clock:** tap Start clock, film the screen with another phone in **slow motion
   (240 fps)** while drawing a fast line. Count frames between the pen tip moving and ink
   appearing: frames × 4.2 ms = latency.
4. **Engine bench:** tap Run bench (it uses 5,000 **generated** strokes, not your notes).
   Note Open, Render, Eraser and Lasso times.
5. Tap **Save result**, then Results > Copy and paste it back to me.

**Editor on a tablet (P1):** open a note in portrait and landscape. The page and the keyboard toolbar
should use the full width; the slash menu and block picker should stay inside the page.

Layout check on the tablet: open every spike in portrait and landscape. Nothing should be cut off,
and buttons should stay at least finger-sized.

## 6. Safe test backend

**There is no online backend.** Sign-in and sync (P2b) use the local emulators on your PC (section 6b). Without that setup the app stores everything on the phone:
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

### 6b. Sign-in and sync on your phone (P2b, emulators only)

Sync talks to the **Firebase emulators on your PC**, not to the internet. Nothing is uploaded anywhere
else, and the emulators forget everything when you stop them.

**Safety first.** Do this only on your **private home Wi-Fi**. When Windows asks, allow Java for
**Private networks only** (never Public). Never do it on school, café or other public Wi-Fi: anyone on
that network could read the test notes.

1. Find your PC's Wi-Fi address. In PowerShell: `ipconfig`. Look under **Wireless LAN adapter Wi-Fi** for
   **IPv4 Address**, for example `192.168.1.20`.
2. Copy `.env.example` to `.env` (if you haven't), then remove the `#` in front of these two lines and put
   your address in the second one:
   ```
   EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-studynotes
   EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=192.168.1.20
   ```
   (The app refuses an emulator address unless the project id starts with `demo-`.)
3. Window 1 (needs `cd firebase && npm ci` once, and Java 21):
   ```powershell
   npm run emulators:lan
   ```
   Wait for "All emulators ready". The emulator UI (http://127.0.0.1:4000) shows users and notes.
4. Window 2: `npm run start:go -- --clear` and open the app in Expo Go as in section 3 or 4.
   (`--clear` makes Metro read the new `.env`.)
5. In the app: **Me > Turn on sync > Create an account**. The emulator sends no real email. To "click"
   the verification link, in a third window run:
   ```powershell
   npm run emu:verify -- you@example.com
   ```
   then tap **I opened the link** in the app.
6. Use any made-up email (for example `rey.test1@example.com`) and a password of 8+ characters.
   Test accounts exist only in the emulator.

**Second device:** a second phone (or a tablet) on the same Wi-Fi with the same `.env`; sign in with the
same email. An Android emulator on the PC can use `10.0.2.2` as the address.

**Android APK against the emulators:** `npm run build:android:emulator` (free EAS account). First open
`eas.json` and replace `SET-YOUR-PC-WIFI-IP` under `"emulator"` with your PC's address. This build allows
plain http **only** to that one address; the normal APK (section 4c) has no sync at all. If your PC's
address changes, rebuild.

**What needs more than the emulator:** Google and Apple sign-in (hidden in P2b), App Check, and syncing
with a real Firebase project. They are marked UNVERIFIED in the checklist.

## 7. AI features

AI features are **18+ only** and need your own free key. The app works fully without a key (Beautify Lite
runs on the phone). Everything in this section works in **Expo Go** on Android and iPhone (no development
build, no paid account).

**Try AI with no key first (Demo AI, development only).** Me > **AI** > Developer > switch on **Demo AI**.
Every AI screen then shows a **DEMO** label, the answers are made up from your own text and end with
"(demo)", and nothing is sent. You still go through the real age check, key wizard (any key in the right
shape, for example `gsk_` plus 20 letters, is accepted by the demo) and consent screens. Switch it off
before testing with a real key. Demo AI does not exist in an installed APK (release build).

**Use AI in a note with your free Groq key (P3b):**
1. Get a key: open https://console.groq.com, sign in (free plan, no card), go to **API Keys** > **Create API
   Key**, name it `notedpo-test` and copy it (it starts with `gsk_`).
2. In the app, open any note and tap the **sparkle** (✨) in the toolbar above the keyboard. The AI panel
   opens.
3. Pick **Beautify**. The first time, you are asked **"What year were you born?"** (the field is empty).
   Type your year and tap Next. If the year alone can't tell, you're asked the month (and only sometimes the
   day). Only "AI available: yes/no" and the date are kept, never your birth date.
4. **Set up AI:** choose Groq > **Open Groq key page** (it asks first, then opens your browser) > come back >
   **Paste** > **Test and save key**. Expected: the panel moves on. A wrong key shows "This key was rejected
   by Groq." and your old key (if any) is kept.
5. **Send to Groq?** Read what is sent and why, then tap **Yes, send to Groq**. ("Not now" sends nothing.)
6. Wait for the answer (you can **Cancel**). The preview shows each change: removed words are struck
   through, added words are underlined and bold. Switch off any change you don't want, then tap **Apply**.
7. Tap **Undo** on the snackbar within 8 seconds to get the exact note back. History also has **Before AI
   change**.
8. Manage everything in Me > **AI**: the masked key (`gsk_…Ab3x`), Test, Replace, Remove, Withdraw
   permission, usage today ("12 of 1,000 requests today"), **Never send to AI** per subject, and your saved
   reports.

**Mistral (optional second provider):** create a key at https://console.mistral.ai (free mode). **Before
using it with your notes**, open its Admin panel > **Privacy** (left-hand menu) and switch off **"Anonymous
improvement data"**. It is separate from the Vibe toggle (Mistral Help Center, Sep 3, 2026). The app shows
this step in the key wizard and on the consent screen.

**Clipboard:** after you save a pasted key, the app clears it from the clipboard. Some keyboards (for example
Gboard) keep their own clipboard history: delete the key there too (long-press it in the keyboard's clipboard
> Delete).

**Groq key for the P0 audio timestamps spike** (developer menu):
1. Go to https://console.groq.com and sign in (free plan).
2. Open **API Keys** > **Create API Key**, name it `study-notes-test`, and copy the key (starts with `gsk_`).
3. In the app **running in Expo Go**: Me > tap the version 7 times > **Developer menu** > **AI key** > paste > **Save key** >
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

### P4b: drawing and ink

All steps UNVERIFIED until your device run. Expo Go works for all of them.

1. Open a note, tap **Draw**. Expected: keyboard closes, drawing toolbar shows (bottom on phones,
   floating on tablets), a one-time tip says two fingers scroll.
2. Draw with **Pen 1**, then **Pen 2** and **Pen 3**. Expected: the pack's three pen colours.
3. Tap the width button: thin → medium → thick.
4. **Highlighter** over a line of text. Expected: the colour sits **behind** the words, which stay readable.
5. With a stylus, press lightly then hard. Expected: the line gets thinner and thicker (pressure).
6. **Eraser** over a stroke: the whole stroke goes. Tap the eraser again (partial mode) and erase
   the middle of a long stroke: it splits in two.
7. **Undo** three times, **Redo** once. Expected: each gesture undoes as one step.
8. **Lasso:** circle two strokes. Drag inside the dashed box to move them; tap Recolour, then Delete.
9. Tap **Done**, then type a new line **above** your drawing. Expected: the drawing moves down with
   its text.
10. Put the cursor at the start of a drawn-on line and press Backspace (joins it with the line above).
    Expected: the drawing stays where it was.
11. Delete a drawn-on line, then Undo. Expected: the drawing disappears with the line and comes back
    with it. ⋯ > "Delete N hidden drawings" appears while it's hidden.
12. Slash menu > **Sketch**: a dashed drawing area appears. Draw inside it; strokes past the edge are cut off.
    Select the sketch and use ⋯ > "Make the selected sketch taller".
13. Change the note's style pack (Style). Expected: pens and highlighter switch to the new pack's colours.
14. Leave the note and open it again. Expected: the drawing is still there.
15. Draw, then swipe the app away from recent apps **without leaving the note**; reopen the app and the note.
    Expected: the drawing is still there (crash recovery).
16. Delete the note and wait 10 seconds. Expected: nothing left (Me > Delete all data also removes drawings).
17. ⋯ menu: switch **Pen input** (automatic / stylus only / finger draws), **Draw with finger**, and
    **Toolbar on the left/right** (tablet). Drag the floating toolbar by its handle; it snaps to a side.
18. Developer menu > **6. Ink diagnostics** (section 5B). Save and send the results.
19. Security: the drawing never appears in any log you send me (Results hold numbers only).
### P2b: sign-in and sync (emulators, section 6b)

Do these with two devices (A and B) where it says so. Write PASS/FAIL. Everything here is **UNVERIFIED on
real phones** until you run it.

| # | Do this | Expected |
|---|---|---|
| 1 | No `.env` Firebase lines: open Me | "Sync isn't set up in this version of the app." Everything else works as in P1. |
| 2 | With the `.env` lines and `npm run emulators:lan`: on A, write 2 notes and a subject as a guest | Me shows **Turn on sync** |
| 3 | A: Me > Turn on sync > Create an account (made-up email, 8+ character password) | "Check your email" screen. Me shows "Confirm your email to turn on sync". |
| 4 | Security: on the emulator UI (Firestore tab) | Nothing of yours is there yet (unverified accounts can't sync) |
| 5 | Run `npm run emu:verify -- <email>`, tap **I opened the link** | "Upload your notes?" shows exactly **2 notes, 1 subject** and a masked email like `r•••@example.com` |
| 6 | Tap **Turn on sync** | Progress "Uploading 0 of 4…" to done; Me shows **Synced**; the note's chip says **Synced** |
| 7 | B: Me > Turn on sync > Sign in with the same account > Turn on sync | B shows both notes and the subject; search on B finds a word from them |
| 8 | Edit a note on A, wait about 30 s (or Me > Sync now on both) | B shows the change; if the note is open on B: "Updated from your other device." |
| 9 | Airplane mode on A and B. Edit the SAME note differently on both. Turn airplane mode off. Sync A, then B | B: Home banner "A note changed on two devices"; the chip says **Needs attention** |
| 10 | B: open the banner > the note | Two versions ("This phone" / "Other device"), changed lines marked. Try **Keep both** | 
| 11 | After Keep both, sync A | A and B both have the original (A's text) and "… (copy from this phone)" (B's text). History on B shows two "Before sync merge" versions |
| 12 | Delete a note on A, wait 10 s, sync A then B | Gone on B too; on the emulator UI the note doc has an empty title and document (erased) |
| 13 | Delete a note on A and tap **Undo** within 8 s, then sync | Note is back on A and was never deleted on B |
| 14 | Security: in the emulator UI, Authentication tab: the account shows no name or photo | Only the email |
| 15 | Me > Sign out on B | B keeps its notes; Me shows Turn on sync. Signing in with ANOTHER new account on B says the phone holds another account's notes |
| 16 | App lock: Me > App lock > turn on (asks for fingerprint/face/PIN) > Immediately. Switch apps and back | The app asks to unlock; in the app switcher NotedPo shows no note (Android: blank; iPhone: blurred). On Android, a screenshot inside the app is blocked |
| 17 | Me > Privacy Policy, Terms of Use, How to delete your account | Each opens inside the app, starts with the **Draft** line, links between them work, works in airplane mode |
| 18 | A: Me > Delete account > password > Delete my account | Steps with counts, then "Your account is deleted". The emulator UI shows **no** documents, files or users left. Choose **Keep my notes on this phone**: A's notes are still there |
| 19 | B (still signed in): Me > Sync now | B says the account was deleted on another device; B keeps its notes and uploads nothing |
| 20 | Logs: in the Metro terminal while doing 3 to 18 | No email, password, note text or token is ever printed |

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
24. **In Expo Go** (`npm run start:go`; the APK has no developer menu): Me > tap the version number
    **7 times** > **Developer menu** > **Typing diagnostics**. For each keyboard
    you have (Gboard, Samsung Keyboard, SwiftKey, the iPhone keyboard): type for about a minute, including a
    long word, an autocorrected word, Enter at the start of a line, a `- ` list and voice typing. Tap
    **Copy log** and paste it into your report with the keyboard's name. The log has no note text, only
    event types and numbers.
25. In a normal note, write down any doubled letters, jumping cursor, lost words or keyboard covering the
    toolbar, with the keyboard name.

**Security checks (P1)**
26. *Links open outside the app:* select a word > **Aa** > link icon > `https://example.com` > **Add link**.
    Tap the link. *Expected:* an "Open link?" dialog showing `example.com`. **Cancel** does nothing; **Open**
    opens your phone's browser as a separate app. Nothing ever loads inside NotedPo.
27. *Pasted content is cleaned:* copy part of a web page with a picture and a link, paste it into a note.
    *Expected:* text and the link stay; the picture doesn't; nothing pops up.
28. *Note text never reaches logs:* while `npm run start:go` runs, write a note titled `SECRETWORD` with
    `SECRETWORD` in the text, and search for it. In the terminal window press **Ctrl+F** and search
    `SECRETWORD`. *Expected:* not found.
29. *Invalid input is rejected:* a subject name of 81 characters, or 41 emoji, is refused with a message (40
    emoji is fine); an exam date `2026-02-30` says "That date does not exist."
30. *Another user's note is not readable:* no accounts exist in P1. Covered by the backend tests (P2a list
    below, item 4).

**Fixes from the code review (P1 r2)**
31. *The last word is kept:* in a note, type a word and **immediately** press the phone's Home button (or
    swipe the app away to the app switcher). Reopen the note. *Expected:* the word is there. Repeat while a
    word is still underlined by the keyboard (mid-word), then press Back. *Expected:* the word is there.
32. *Tables survive copy and paste:* insert a table (+ > Table), type in two cells, select the whole table,
    **Cut**, put the cursor on a line below and **Paste**. *Expected:* still a table with your text.
33. *No developer menu in the APK:* in the APK (not Expo Go), Me > tap the version number 10 times.
    *Expected:* nothing happens and no "Developer menu" row appears.

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
22. *Security:* deny the microphone permission once (Settings > Apps > Expo Go or NotedPo >
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

### P3b: AI screens (Expo Go or APK)

Use a test note with a few lines, for example "osmosis - movement of water across a membrane". Steps 1 to 12
work with **Demo AI** (no key). Steps 13 to 17 need your real free Groq key (section 7). Write PASS / FAIL.

1. Me > AI > Developer > Demo AI **on**. *Expected:* a DEMO warning on the AI settings screen.
2. Open a note, tap the **sparkle**. *Expected:* the AI panel with "DEMO", Use: **Selection** (greyed out) /
   **Whole note**, the provider chips, and the actions. **Make flashcards** and **Quiz me** are *not* listed
   (they come in P4c). **Explain this** says "Select text in the note first."
3. Tap **Beautify**. *Expected:* "What year were you born?" with an **empty** field. The screen does not
   mention 18 or "adult".
4. Type a year more than 19 years ago, tap Next. *Expected:* "Set up AI" with the Groq and Mistral cards
   (badges such as Free plan, No card needed; Mistral shows "May train on your notes unless you turn it
   off").
5. Choose Groq, type `gsk_` + 20 letters, tap **Test and save key**. *Expected:* "Send to Groq?" showing
   who receives it, what is sent, why, and what Groq does with it.
6. Tap **Not now**. *Expected:* back to the actions with "Nothing was sent."
7. Tap Beautify again > **Yes, send to Groq**. *Expected:* a short "Waiting for Groq…", then the preview with
   one change ending in "(demo)".
8. Switch the change **off**. *Expected:* the button says "Nothing selected". Switch it back on > **Apply 1**.
   *Expected:* the panel closes, the note shows the change, and a snackbar "Beautify: 1 change applied" with
   **Undo**.
9. Tap **Undo**. *Expected:* the note is exactly as before. History lists **Before AI change**.
10. Open the panel, run Summarize, then tap **Report this AI result** > pick a reason > Save. *Expected:*
    "Report saved on this phone." It is listed in Me > AI > Your AI reports, and you can delete it.
11. Open the panel and press the **X** (or Android back). *Expected:* it closes with no error message and the
    note is unchanged.
12. Me > AI > a subject > **Never send to AI** on. Open a note in that subject > sparkle. *Expected:* "AI is
    off for this subject" and nothing else.
13. Switch Demo AI **off**. Me > AI > Groq > **Replace key**: paste your real key > Test and save.
    *Expected:* saved; the screen shows only `gsk_…` plus 4 characters.
14. Run **Beautify** on a real note. *Expected:* a real answer within about 10 seconds; the preview shows
    removed words struck through and added words underlined.
15. Turn on airplane mode and run an action. *Expected:* "Needs internet. You can still use Beautify Lite."
16. Me > AI > Groq: the usage line counts your requests ("N of 1,000 requests today").
17. *Security:* in the terminal running Metro, search for `gsk_`. *Expected:* your key does not appear. Then
    Me > **Delete all data**. *Expected:* Me > AI shows no keys, the age check "Not checked yet", and no
    reports.

18. *Safety:* open a note with text and tap the sparkle right after opening it. *Expected:* the panel opens
    normally. (If the editor ever hands over an empty page, you'd see "This note couldn't be read just now,
    so AI didn't run" and the note stays as it is: tell me if you ever see it.)

**Under-18 path (any phone):** Me > Delete all data, open a note > sparkle > Beautify > type a year less than
17 years ago. *Expected:* "AI isn't available" with one **Done** button and a pointer to Beautify Lite. Tapping
the sparkle again shows the same panel without asking again. Me > AI shows "AI isn't available to you" with no
Add key button.

### P5: style packs and Match a look (Expo Go or APK)

Everything in P5 works in **Expo Go** on Android and iPhone. The photo picker, the image tools and Skia
are all built into Expo Go, so no paid Apple account is needed. Steps 1 to 14 need no AI key; steps 15 to
19 need your free Groq key (section 7). Before you start, take two photos with your phone: one of a page
in a **lined** notebook with some writing, and one of a page with **highlighter** marks. A screenshot of a
notes picture you like also works. Write PASS / FAIL for each step.

1. Me > Default look (or a new install's "Pick your look"). *Expected:* 13 looks as small cards (Pastel
   Highlight first, then Color Code ... Chalkboard), with one live preview above them that changes when
   you tap a card.
2. Pick **Seoul Minimal**, then **Kawaii Pop**, then **Pastel Highlight** and open a note in each.
   *Expected:* the headings use the pack's own handwriting or rounded font, not your phone's normal font.
   In Pastel Highlight the headings are Gaegu (round handwriting). Known gap: Gaegu has no "ñ" or accented
   letters, so a heading like "Niño" shows the "ñ" in a plain font. The same goes for Seoul Minimal's body
   text.
3. Open a note > Style. *Expected:* the note itself at the top in its current look, the 13 looks below,
   and **Match a look from a photo**. Tap Dark Academia. *Expected:* the note turns dark, the text is
   unchanged, and History shows "Before style change".
4. Me > **Font licences**. *Expected:* 22 fonts, each with its copyright line, and the full SIL Open Font
   License text. Gaegu, Gowun Dodum, Mochiy Pop One and Zen Maru Gothic say "(Latin subset)".
5. Tap the centre **+** > **Match a look**. *Expected:* a short explanation saying the photos stay on this
   phone, plus **Choose photos** and **Take a photo**. No permission pop-up yet.
6. Tap **Choose photos**. *Expected:* the phone's own photo picker. On Android there is **no** "allow access
   to photos" pop-up. Pick your lined-paper photo.
7. *Expected:* "Cleaning your photos (removing location and camera details)..." and then "Finding the
   paper..." for a few seconds, then the result screen. Write down roughly how many seconds it took
   (target: under 2 seconds per photo).
8. *Expected:* the preview shows a page with ruled lines and colours like your photo. The **Paper** chip
   says "Lined". Below it says "Closest built-in look: ...".
9. Tap the **+** on the slider several times. *Expected:* the preview moves step by step toward the
   closest built-in look. At the far right it looks exactly like that pack. Tap **-** back to the left.
10. Tap the **Paper** chip > **Grid**. *Expected:* the preview switches to grid paper. Tap **Header
    colour** and pick another swatch. *Expected:* the headings change colour and stay readable (the app
    darkens a colour that would be too pale).
11. Tap **Highlighters** and switch one off. *Expected:* that highlighter colour is no longer used.
12. Name it "Test look" > **Just save**. *Expected:* the screen closes. Open a note > Style: "Test look"
    is in the grid with the tag "Yours". Tap it. *Expected:* the note uses your look.
13. Style > **Rename or delete your looks** > rename it > Save name, then **Delete look** > Delete.
    *Expected:* it disappears, and the note that used it goes back to Pastel Highlight.
14. **Security checks:**
    - **Size limit:** + > Match a look > pick **4** photos. *Expected:* at most 3 can be selected, or
      the message "Pick 1 to 3 photos."
    - **Bad name:** type the name `<b>hi</b>` and save. *Expected:* "Use letters, numbers and simple
      punctuation for the name."
    - **No location data:** (Android, optional) after a match, check your phone's Files app >
      Android/data/io.github.bantutti.notedpo/cache. *Expected:* no copies of your photo are left.
15. With your Groq key set up (P3b steps), run Match a look again. On the result screen tap **Improve with
    AI (sends your photo to Groq)**. *Expected:* **"Send photos to Groq?"**, a consent screen that is
    separate from the one for notes. It says what is sent (the reference photos and your key, no notes)
    and why.
16. Tap **No**. *Expected:* "Nothing was sent. Your look from this phone is kept." Tap the button again >
    **Yes**. *Expected:* a spinner, then "The AI suggested: header ..., ..." and the preview changes only
    its design (header style, bullets, fonts). The colours and paper stay the same.
17. Me > AI. *Expected:* the photo consent for Groq is listed separately from note text, and you can
    withdraw it. Withdraw it and tap **Improve with AI** again. *Expected:* the photo consent screen
    appears again.
18. If you answered the age question with an under-18 year in P3b: *Expected:* **Improve with AI** says
    AI is for people 18 and older and points to Me > AI. Nothing is sent.
19. Turn on airplane mode and tap **Improve with AI**. *Expected:* an offline message. The look from the
    phone is still there and **Just save** still works.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| QR code will not scan | Make the terminal window bigger, or in Expo Go use "Enter URL manually" with the `exp://…` address shown under the QR code. On iPhone use the Camera app, not Expo Go's scanner. |
| "Something went wrong" / app stuck on loading | Press `r` in the terminal to reload. If still stuck: stop with Ctrl+C, run `npx expo start --go --clear`. |
| Metro not reachable / "Could not connect to development server" | Same Wi-Fi? Allow Node.js in Windows Firewall (section 3). Try `npm run start:go:tunnel`. On a VPN, turn it off. |
| Expo Go says the project needs a newer SDK | Update Expo Go from the store. The project uses Expo SDK 58. If Expo Go in the store has moved to a newer SDK, tell me: the project needs a short SDK upgrade (or use the APK, section 4c). |
| `npm ci` fails with "Unsupported engine" | Install Node 24 LTS (section 1) and reopen the terminal. |
| `npm ci` fails with EPERM / file locked | Close VS Code and any running `expo start`, then retry. Avoid OneDrive-synced folders. |
| Microphone permission denied | Phone Settings > Apps > Expo Go (or NotedPo) > Permissions > Microphone > Allow. |
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
| Drawing: my palm makes marks | Draw once with the pen first (the app then knows you have a stylus), or ⋯ > Pen input > stylus only. Send me the Ink diagnostics "Palm rejected" number. |
| Drawing: the page won't scroll in Draw mode | Use two fingers. One finger scrolls only after a stylus has been seen (or with Pen input = stylus only). |
| Drawing: "The page is still loading" | Wait a second after opening the note and draw again. If it keeps happening, tell me your device. |
| Drawing: a banner says part of the drawing is damaged | Your last good copy is shown. Send me the steps; don't delete the app. |
| Sync: "Sync isn't set up" with the `.env` lines in place | Restart Metro with `npm run start:go -- --clear`. Check there's no `#` in front of both lines and the project id starts with `demo-`. |
| Sync: Offline / stuck on "Uploading…" | Is `npm run emulators:lan` running? Phone and PC on the same Wi-Fi? Allow Java on **Private** networks in Windows Firewall. Did your PC's address change (`ipconfig`)? |
| Sign-up works but Turn on sync keeps saying "Confirm your email" | Run `npm run emu:verify -- <email>` (same email, lower case), then tap **I opened the link**. |
| APK built with the emulator profile fails: "must be your PC's private Wi-Fi IPv4 address" | Put your real address into `eas.json` > `emulator` > `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST`. |
| App lock can't be turned on | Set up a screen lock (PIN, pattern, fingerprint or face) in the phone's settings first. |
| E2E sync tests on the PC | `cd firebase && npm ci` once, then from the project root `npm run test:sync-e2e` (Java 21). |
| AI panel: "This key was rejected by Groq." | Copy the key again from https://console.groq.com/keys (all of it, no spaces), then Me > AI > Replace key. |
| AI panel: "Your free Groq limit is used up for now" | You hit the free daily limit. Wait the time shown, or add a Mistral key and tap "Use Mistral instead". |
| AI panel: "…answer didn't make sense twice" | Try again; if it keeps happening, tap Report this AI result and send me the report details (Me > AI). |
| The sparkle doesn't appear in the toolbar | The toolbar shows it once the note's editor has loaded. Reload with `r` in the terminal. |
| AI says "AI isn't available" but you are 18+ | You entered a year that made you under 18. Me > Delete all data (this wipes your notes too), or wait for "Check my age again" (offered after a year). |
| AI live check: 401 with your real key | Copy the key again from the provider's key page (no spaces). |
| AI live check: 429 | You used the free limit; wait or try tomorrow. Mistral 400 on Beautify: report it (schema field names). |

### P5 troubleshooting
| Problem | Fix |
|---|---|
| "Photo 1 couldn't be read" | Try a JPEG or a screenshot. Some cloud-only photos must download first: open the photo in your gallery once, then pick it again. |
| The paper type is wrong (for example "Plain" for lined paper) | Tap the Paper chip and choose the right one. Photos taken from very far away make thin lines too faint to find. |
| "Improve with AI" says to open AI settings | Set your age and Groq key in Me > AI (section 7), then come back. |
| Match a look is slow | Note the phone model and the seconds in your report (step 7). Using 1 photo instead of 3 is about 3 times faster. |

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
