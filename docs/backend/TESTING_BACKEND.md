# Testing the P2a backend on Windows (beginner guide)

> **P2a addendum to TESTING_ON_DEVICE.md.** P2a is backend only: security rules, schemas and the account-deletion module. There is **no new app screen to test on your phone yet**. The phone steps arrive with P2's app side (sign-in and sync). This guide tests the backend on your Windows PC with the Firebase emulators, which are a local, fake Firebase. **No Firebase account, no billing, no real data.**

## 1. Prerequisites (all free)

| What | Version | Cost | How to get it |
|---|---|---|---|
| Node.js | **24.x** (must be 24) | Free | Download the Windows installer `node-v24.*-x64.msi` from https://nodejs.org/dist/latest-v24.x/ and run it. |
| npm | 11.x (comes with Node 24) | Free | Installed with Node |
| Java JDK | **21 or newer** (the emulators refuse older Java) | Free | In PowerShell: `winget install EclipseAdoptium.Temurin.21.JDK` |
| Firebase account | — | **Not needed** | The emulators use the fake project `demo-studynotes` |
| Google Cloud CLI | — | Free, **optional** | Only for the admin deletion script on a real project later |

After installing, **close and reopen PowerShell**, then check:

```powershell
node -v      # should print v24.something
npm -v       # should print 11.something
java -version   # first line should mention version "21" (or higher)
```

## 2. Setup

1. Unzip `StudyNotesApp-P2a-backend-YYYYMMDD.zip` to a short path, for example `C:\dev\StudyNotesApp-P2a`.
2. Open PowerShell and go to the backend folder:

```powershell
cd C:\dev\StudyNotesApp-P2a\firebase
npm ci
```

`npm ci` installs the exact versions from `package-lock.json` and takes 1 to 3 minutes. There is **no `.env` file** in P2a: no secrets are needed.

## 3. Run the tests

### 3a. Quick schema tests (no Java needed, about 5 seconds)

```powershell
npm run test:unit
```

Expected: `Tests  20 passed (20)`.

### 3b. Full suite with the emulators (about 1 to 2 minutes)

```powershell
npm test
```

The first run downloads the emulators (about 150 MB) into `%USERPROFILE%\.cache\firebase\emulators`.

Expected at the end:

```
Test Files  9 passed (9)
     Tests  586 passed (586)
```

You'll see many `PERMISSION_DENIED` lines while it runs. **That's normal and good:** they're the tests proving that forbidden actions are blocked.

If Windows Firewall asks about Java, you can click **Cancel**. The emulators only listen on `127.0.0.1` (this PC), so no network access is needed.

### 3c. Lint, typecheck, audit (the phase gate)

```powershell
npm run typecheck
npm run lint
npm run audit
```

Expected: typecheck and lint print nothing (success). `npm run audit` fails only on **high or critical** issues and should pass. To see everything, run `npm run audit:all`: it lists 7 **moderate** entries inside `firebase-tools` (a dev tool, never shipped in the app; explained and accepted in SECURITY_REVIEW.md F-5).

Or run everything at once: `npm run gate`.

## 4. Watch the rules work (good for a demo or a defense)

1. Terminal 1, start the emulators and leave them running:

```powershell
npm run emulators
```

2. Open **http://127.0.0.1:4000** in your browser (the Emulator UI).
3. Terminal 2, point the tests at the running emulators and run them:

```powershell
cd C:\dev\StudyNotesApp-P2a\firebase
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
$env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
$env:FIREBASE_STORAGE_EMULATOR_HOST="127.0.0.1:9199"
npx vitest run tests/rules/firestore.access.test.ts
```

4. In the Emulator UI, go to **Firestore → Requests**. Each request shows **ALLOW** or **DENY**; click one to see which rule line decided it.
5. Press **Ctrl+C** in terminal 1 to stop the emulators. Emulator data is thrown away when they stop.

## 5. Phase test checklist (P2a)

Each item maps to a test. "Expected" is what the test asserts.

| # | Check | Where | Expected |
|---|---|---|---|
| 1 | A signed-out user reads or writes anything | access › identity | Denied |
| 2 | A signed-in user with an **unverified email** reads their own note | access › identity | Denied |
| 3 | Alice reads her own note | access › ownership | Allowed |
| 4 | **Bob reads, updates or deletes Alice's note** | access › ownership | Denied |
| 5 | Bob creates a doc claiming Alice as owner, or overwrites hers with himself as owner | access › ownership | Denied |
| 6 | A query without `where owner == me`, or without a limit, or with limit > 500 | access › queries | Denied |
| 7 | Writing to local-only paths (noteVersions, aiJobs) or unknown collections | access › closed paths | Denied |
| 8 | A client-clock `created`/`updated`, `rev` not 1 on create, a doc created as deleted | lifecycle › create | Denied |
| 9 | A stale offline edit (old `rev`) | lifecycle › update | Denied (becomes a conflict copy in the app) |
| 10 | Changing `id`, `owner` or `created` | lifecycle › update | Denied |
| 11 | **An oversized title** (201 characters) or an unknown extra field | lifecycle › update; agreement | Denied |
| 12 | Hard-deleting a live note | lifecycle › hard delete | Denied (tombstone first) |
| 13 | **Editing a review log** (rating, time, device) | reviewLogs › edits | Denied |
| 14 | Re-uploading the same review log id | reviewLogs › create | Denied |
| 15 | Deleting a review log while its card is live | reviewLogs › delete | Denied |
| 16 | Any write after account deletion started | lifecycle › account deletion | Denied |
| 17 | Uploading HTML or SVG into images, a file without an asset doc, a size mismatch, or a file over the cap | storage › uploads | Denied |
| 18 | Bob reads, lists or deletes Alice's files | storage › reads | Denied |
| 19 | **Account deletion removes every doc, file, the profile and the Auth user, and leaves Bob alone** | deletion | Nothing left for Alice; Bob intact |
| 20 | Deletion interrupted mid-way, then run again | deletion | Finishes; nothing left |
| 21 | The admin script without `--confirm` | admin | Dry run: nothing deleted |
| 22 | zod and the rules agree on every field boundary (491 generated cases) | agreement | All agree, except 4 documented gap kinds |

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| `npm : running scripts is disabled on this system` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `npm.cmd` instead of `npm`. |
| `firebase-tools no longer supports Java version before 21` | Install Java 21 (section 1), reopen PowerShell, check `java -version`. If an old Java still shows, remove it in Settings → Apps, or put Java 21 first in PATH. |
| `Could not spawn java -version` | Java isn't installed or not on PATH. Reinstall with winget, then reopen PowerShell. |
| `npm ci` says the engine is unsupported | You have Node 22 or 26. Install Node **24** from the link in section 1. |
| `Port 8080 is not open` / port already in use | Another program uses the port. Close it, or change the port in `firebase.json` (and the `$env:` lines in section 4). |
| Tests time out on the first run | The emulator download was slow. Run `npm test` again. |
| `EACCES` / file-in-use errors on `npm ci` | Close VS Code terminals running the emulators, then retry. |

## 7. Reporting a problem

Paste back to me:
1. Your Windows version (Settings → System → About) and the output of `node -v` and `java -version`.
2. The exact command you ran.
3. The last 40 lines of output. In PowerShell: `npm test *>&1 | Select-Object -Last 40`
4. A screenshot if the Emulator UI looks wrong.

Never paste real passwords or API keys. P2a needs none.
