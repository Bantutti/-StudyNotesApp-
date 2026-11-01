# Phase report: P3b AI screens

| | |
|---|---|
| Phase | P3b, AI screens (Track B, Dev Engineer worker). The Lead approved the plan with every ★ option on Nov 1, 2026 |
| Date | 2026-11-01 (Asia/Manila) |
| Zip | `{{ZIP_NAME}}` ({{ZIP_FILES}} files, {{ZIP_BYTES}} bytes) |
| SHA-256 | `{{ZIP_SHA256}}` |
| Code | GitHub `Bantutti/-StudyNotesApp-`, branch `phase/p3b-ai-ui`, draft PR #7. Cut from `phase/p1-core-app` at 8855b26; **main (21b29b8: P1 merged as 91882b6, plus the Gaegu font fix) is merged in**, so the PR diff is P3b only |

> The copy of this report **inside** the zip shows the placeholders above, because a zip can't contain its
> own checksum. The real values are in `exports/<zip>.sha256` and in the copy uploaded next to the zip
> (`PHASE_REPORT-P3b.md`).

## 1. What was built

The P3a engine, in front of the student. The flow follows Plan v0.2 Flow 4 and the screens table. Everything
runs in Expo Go (Android and iPhone) and in the Android APK. Nothing is published.

| Area | Built |
|---|---|
| Entry point | One `ai` action in P1's keyboard-toolbar **sparkle slot**, registered through the documented editor hook (no editor internals touched). The flow is a modal over the note |
| Action sheet | Scope (Selection / Whole note), provider chip, usage "Groq · 12 of 1,000 requests today", 9 actions with descriptions. Explain needs a selection. Make flashcards and Quiz me are **hidden** (Q5 = B: they move to P4c) |
| 18+ age check | Birth year, empty field, no mention of the cut-off before the answer (Q2 = A). Month only in the boundary year (Q3 = A); the day only when the birth month is this month. Stores **only** `{adult, checkedAt}`. An under-18 answer sticks; a re-check is offered after one year (Q4 = A) |
| Under 18 | One calm panel ("AI isn't available… Beautify Lite still works"), one Done button, no nagging. Settings offers no Add key |
| Key wizard | Provider cards with catalog badges, age rule, data use and costs. **Open key page** (outside the app, after a confirm), paste (hidden field), **Test and save** with the *candidate* key (a rejected key never replaces a working one), clipboard cleared, Save anyway when the check couldn't run. The wizard always comes after the age check |
| Consent | Per provider and version (Apple 5.1.2(i)): recipient, what is sent, why, data use, Mistral's training opt-out, age rule, privacy and terms links. "Yes, send to Groq" / "Not now" |
| Running | Progress text ("part 2 of 3", "pacing for the free plan", "trying the backup model"), **Cancel** |
| Errors | The P3a message (provider named) plus **one next step**: Try again, Replace key, Use Mistral instead, OK (Beautify Lite) |
| Diff preview | Plain-text word diff (struck-through removed, underlined bold added), per-block toggles, Accept all, Discard, stale changes locked off, AI-added tag |
| Apply and Undo | `applyProposal` → P1's `runEditorAction`: schema and cloud caps, **"Before AI change"** version, save, 8-second Undo that restores the exact note with the same block ids (tested on real SQLite) |
| Report | "Report this AI result": reason and optional 200-character comment, **local only**, metadata only (no note or AI text); listed and deletable in settings |
| Me → AI | Age status (and the age check itself), masked keys, Test / Replace / Remove, consent Withdraw, usage and tokens today with the limits' check date, default provider, **Never send to AI** per subject, reports, Demo AI (dev builds) |
| Demo AI | Development builds only, labelled DEMO everywhere: the real flow with made-up answers from your own text, no network |
| Consent kinds (Lead, Nov 1, for P5) | Separate versioned consent for **photos** (`image`) next to note **text**, with their own catalog wording; `checkCanSend(gate, { provider, kind })` and a reusable `ConsentStep kind="image"` exported for P5; Me → AI shows and withdraws each kind separately |
| Guards (Lead, Nov 1) | The AI won't run on an empty hand-over while the stored note has text, and won't apply a result that removes all the text. In release builds Groq (including the transcriber) is reachable only after the 18+ answer and Groq consent |
| Fixes in shared files | Delete all data removes **both** keys (the Mistral key used to survive) and the `ai/` folder, and drops cached AI state. Closing an editor action no longer shows an error alert |

New module: `aiui` (`src/modules/aiui`, public `index.ts`, companion `ALGORITHMS.md`). Changed: `ai` (Track B:
`testKey` candidate, `usage.reload`), `composition` (wiring), a few lines in shared app files (see §6).

## 2. How to run it

```powershell
npm ci
npm run start:go          # scan the QR code with Expo Go (TESTING_ON_DEVICE §3 and §4)
```

On the phone, open a note and tap the **sparkle** in the toolbar. To try it without a key: Me > AI >
Developer > **Demo AI**. Full steps: `TESTING_ON_DEVICE.md` §7, checklist **P3b** in §8.

## 3. Tests and checks (clean install, Node 24.22.1, npm 11.19.1, Linux sandbox)

| Check | Result |
|---|---|
| `npm run verify` | Pass: editor page up to date, types, lint (0 warnings), **648 passed / 10 skipped** (63 suites; main 21b29b8 base 476), secret scan clean, prod audit 0 |
| New tests | 172 in P3b: aiui 151 (age rule, gate, consent kinds, reports, flow, diff and wording, demo, screens, settings, static security), composition 15 (the action through `runEditorAction` on real SQLite; Delete all data; empty-document guard; Groq only through the gate), ai 6 (candidate key, reload) |
| Production dependency audit | **0 vulnerabilities** |
| Full audit (incl. dev tools) | 7 low (deepmerge via Jest, dev-only, no fix): unchanged from P1, accepted as P0-S6 |
| `npm run bundle:check` | Pass: Android 8.3 MB, iOS 8.3 MB (P1: 8.1 MB) |
| Dependencies | **None added.** Component tests use P1's `test-renderer` 1.3.1 (Q8 approved adding @testing-library/react-native; it wasn't needed) |

**UNVERIFIED on real phones** (device check at the end of the build): the modal's look on small phones and
tablets, the keyboard over the key and age fields, iOS swipe-down closing, clipboard behaviour per keyboard
app, and a live run with your real Groq and Mistral keys (P3a's live check is still pending).

## 4. Security review (full table: `docs/SECURITY.md` §4d)

| ID | Severity | Finding | Status |
|---|---|---|---|
| P3b-S1 | Medium | Delete all data left the Mistral key | **Fixed**, tested |
| P3b-S2 | Low | Delete all data left `ai/usage.json` and cached AI state | **Fixed**, tested |
| P3b-S3 | Medium | The 18+ gate is self-declared | **Accepted** (Rey's decision); legal review before production |
| P3b-S4 | Medium | A key could be added or tested before the age check (settings, Replace key) | **Fixed**, tested |
| P3b-S5 | Low | A pasted key can stay in a keyboard's clipboard history | **Mitigated** (app clipboard cleared; documented) |
| P3b-S6 | Low | AI text as markup in the preview | **Fixed by design** (plain Text; static test) |
| P3b-S7 | Low | Reports leaking content | **Fixed by design** (metadata-only schema) |
| P3b-S8 | Low | Demo AI in release | **Fixed** (dev only; test) |
| P3b-S9 | Info | `gate.json` editable on a rooted phone | Accepted |
| P3b-S10 | Info | The subject switch lookup failing | **Fixed** (fail closed) |
| P3b-S11 | Medium | P1 bug: an empty doc handed to an action could be saved over the note | **Guarded** (the AI refuses to run or apply; tests); P1 fixes the root cause |
| P3b-S12 | Medium | Developer screens could reach Groq outside the gate | **Fixed** (release: the transcriber gets no key until P4 adds audio consent; tests); P1 locks the developer menu |
| P3b-S13 | Medium | One consent covered every data type | **Fixed**: consent per provider, data kind (text, image) and version; `checkCanSend` takes the kind; tests |

**No high-severity findings are open.** Keys are never logged, stored outside secure storage, put in state or
navigation params, or shown in full (tests cover the success and failure paths).

## 5. Deviations from the approved plan (for the Lead)

1. **Modal, not routes.** The AI steps render in one React Native Modal (`AiFlowHost`). Pushed routes would
   blur the note screen, and P1's `useFocusEffect` cleanup would then save a "When you left" version and
   reload the editor on every AI run. Only AI settings is a route (`src/app/ai/settings.tsx`).
2. **Strings in the module.** The about 160 AI strings live in `src/modules/aiui/strings.ts`, not
   `core/strings.ts`, so the shared file grows by only 3 lines (the Lead's rule while P2b edits it too). They
   follow the same `{placeholder}` rules, and translation uses `setAiStrings()`.
3. **No new test dependency** (see §3).
4. **The age check sometimes asks the day:** only in the boundary year *and* when the birth month is this
   month, because the month alone can't decide that case. It is never stored. Feb 29 counts as Mar 1.
5. **Per-subject "Never send to AI"** is in Me → AI (P1's subject form has no toggle), using
   `store.subjects.update`, so no Track A screen changed.
6. **Stricter key rule** (P3b-S4): no key can be added or tested before an adult answer.

## 6. Shared files touched

| File | Lines | Why |
|---|---|---|
| `src/composition/services.ts` | ~25 | Wiring (`ai`, `aiui`, `Adapters.aiFile`) plus the two Delete-all-data fixes |
| `src/composition/index.ts` | +2 | Exports |
| `src/composition/__tests__/services.test.ts` | +2 | Adapters gain `aiFile` |
| `src/app/_layout.tsx` | +3 | `<AiWiring />` and the `ai/settings` screen |
| `src/app/(tabs)/me.tsx` | ~4 | AI row; accurate "Your data" text |
| `src/app/note/[id].tsx` | 2 | No alert on `cancelled` |
| `src/core/strings.ts` | +3 | `me.dataAi`, `me.ai`, `me.aiRow` |
| Shared docs | | ARCHITECTURE, SECURITY, CHANGELOG, TESTING_ON_DEVICE, README, modules/ai.md |

## 7. Known limits

- **Undo** brings back the exact note from before the AI change, even if you typed during the 8 seconds (the
  same as Beautify Lite; P1's hook). History keeps both versions.
- **Explain** needs a selection from the editor. If a keyboard's selection isn't reported on some phone
  (UNVERIFIED), use Whole note actions.
- **Usage numbers** count the student's local day; providers reset on their own clocks (P3a §8).
- **Make flashcards and Quiz me** are built in the engine but hidden until P4c saves cards.
- **Live AI** with real keys still depends on Rey's P3a live check (`docs/modules/ai.md`).

## 8. What's next

- The Lead merges P1 into main; I merge main into this branch and re-run the gate.
- **P4 (voice):** Whisper also sends to Groq (18+). Use `GateStore.isAdultConfirmed()` and the §1 helpers
  from `@/modules/aiui`, and show Groq's consent before the first transcription.
- **P4c:** set `AI_CARDS_ENABLED = true` once the card list and quiz screens can save `CardDraft` and
  `QuizDraft`, and test the cloze format.
- **P7:** re-check the providers' free limits and terms (catalog `checkedOn` 2026-11-01), plus the legal review
  of the age gate.
