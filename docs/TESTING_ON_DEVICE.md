# Testing on your own phone or tablet

This guide is for testing on real devices from a **Windows PC with no Mac**. Follow it top to bottom
the first time. Commands go in **PowerShell** or **Command Prompt** opened in the project folder.

> Phase covered: **P0 (prototype spike lab)**. Updated every phase.

---

## 1. Prerequisites

| What | Why | Cost |
|---|---|---|
| **Node.js 24 LTS** from https://nodejs.org (choose "LTS", version 24.x) | Runs the dev server. npm 11 is included. | Free |
| **Git for Windows** from https://git-scm.com (optional) | Version control | Free |
| **Expo Go** app on your phone (Play Store / App Store) | Runs the app without building it | Free |
| **Expo account** at https://expo.dev/signup | Only needed for the Android development build (section 4b) | Free plan is enough |
| **Groq account** at https://console.groq.com | Only for the audio timestamps spike (section 7) | Free tier |
| Apple Developer Program | Only for an iPhone development build. **Not needed in P0.** | Paid (99 USD/year) |
| Firebase project | Starts in P2. **Not needed in P0.** | Free tier |

Check Node after installing (close and reopen the terminal first):

```powershell
node -v      # must print v24.x.x
npm -v       # prints 11.x.x
```

> If `node -v` shows another major version (for example v22), the project will refuse to install.
> Install Node 24 LTS and reopen the terminal.

## 2. Setup

1. Unzip `StudyNotesApp-P0-prototype-<date>.zip` to a short path, for example `C:\dev\StudyNotesApp`
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
4. Create your local environment file (P0 needs **no secrets**, but keep the habit):
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
4. The first load bundles the app (up to a minute). You should see **P0 Spike Lab**.

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

**What works on iPhone in P0 with Expo Go:** editor, export, FSRS, audio timestamps, ink.
**What does not:** the 90-minute **background** recording. In Expo Go, recording stops when the
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
6. Open the new **Study Notes (P0 Spike Lab)** app on the phone (not Expo Go). It finds the server
   on the same Wi-Fi, or scan the QR code from inside the app.

> Phases that need a development build: **P0 recording spike** (background), **P2** if
> native Firebase modules are added, and likely **P4** (voice) and **P4b** (ink tuning).
> Rebuild only when native dependencies or `app.json` plugins change; JavaScript changes reload
> instantly.

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

Layout check on the tablet: open every spike in portrait and landscape. Nothing should be cut off,
and buttons should stay at least finger-sized.

## 6. Safe test backend

**P0 has no backend.** Nothing is stored online and there are no accounts, so there is nothing to
set up. From **P2**, this section will explain the **Firebase Local Emulator Suite** and a separate
**test Firebase project** (never production data), and how to create a test account.

What P0 stores, all inside the app's private storage on the phone:
- results log (metrics only), recordings (`recordings/` folder), temporary exports (cache),
- your Groq key in Keychain (iPhone) / Keystore-backed storage (Android).

Uninstalling the app (or Expo Go) deletes all of it.

## 7. AI features (Groq key for audio timestamps)

1. Go to https://console.groq.com and sign in (free tier).
2. Open **API Keys** > **Create API Key**, name it `study-notes-test`, and copy the key
   (it starts with `gsk_`).
3. In the app: Home > **AI key** > paste into the field > **Save key** > **Test key**.
   Expected: "Key works." The screen then shows only a masked version like `gsk_…3fQa`.
4. **Never share the key, never paste it into chats or issues, never commit it or put it in
   `.env`.** If you think it leaked, delete it in the Groq console and create a new one.
5. To remove it from the phone: AI key screen > **Delete**.

## 8. Phase test checklist (cumulative)

Write PASS / FAIL and any numbers next to each step. Then open **Results log** > **Copy all as
Markdown** and paste it back to me with your notes.

### P0: spike lab

**Home**
1. App opens on **P0 Spike Lab**. *Expected:* blue banner saying it uses SAMPLE data; your device
   model and runtime (expo-go or dev-build) are shown; six spike cards say UNTESTED.

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

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| QR code will not scan | Make the terminal window bigger, or in Expo Go use "Enter URL manually" with the `exp://…` address shown under the QR code. On iPhone use the Camera app, not Expo Go's scanner. |
| "Something went wrong" / app stuck on loading | Press `r` in the terminal to reload. If still stuck: stop with Ctrl+C, run `npx expo start --go --clear`. |
| Metro not reachable / "Could not connect to development server" | Same Wi-Fi? Allow Node.js in Windows Firewall (section 3). Try `npm run start:go:tunnel`. On a VPN, turn it off. |
| Expo Go says the project needs a newer SDK | Update Expo Go from the store. P0 uses Expo SDK 58. |
| `npm ci` fails with "Unsupported engine" | Install Node 24 LTS (section 1) and reopen the terminal. |
| `npm ci` fails with EPERM / file locked | Close VS Code and any running `expo start`, then retry. Avoid OneDrive-synced folders. |
| Microphone permission denied | Phone Settings > Apps > Expo Go (or Study Notes) > Permissions > Microphone > Allow. |
| Recording stops when the screen locks | Expected in Expo Go. Use the Android development build (section 4b). |
| Development build cannot find the server | Run `npm run start:dev` (not start:go). Same Wi-Fi, or scan the QR code from inside the dev app. |
| EAS build fails | Run `npx eas-cli@latest whoami` to check login. Copy the build log link and send it to me. |
| Groq: "rejected the key" | Copy the key again (no spaces), save, Test key. Create a new key if it was deleted. |
| Groq: "file is larger than 25 MB" | Use the Speech preset; High quality is about 58 MB per hour. |
| Export share sheet does not open | Some phones need a PDF viewer or Word/Docs installed. Try Print… to check the layout. |
| Fonts look like system fonts in exports | Only the P0 packs' fonts are bundled. Packs other than Pastel Highlight and Dark Academia fall back. |

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
