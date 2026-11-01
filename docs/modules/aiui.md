# aiui

**Purpose.** The AI screens (P3b): they put the P3a engine (`@/modules/ai`) in front of the student,
following Plan v0.2 Flow 4. The pieces are the action sheet, the age check (18+), the key wizard, the
consent screen, run progress with Cancel, the diff preview with per-block accept toggles, Apply with exact
Undo and a "Before AI change" version, "Report this AI result" (saved on the phone only), the usage meter,
and Me → AI settings.

Rules and maths: [`src/modules/aiui/ALGORITHMS.md`](../../src/modules/aiui/ALGORITHMS.md) (code comments cite
it as §X.Y). §1 is the age rule, §2 the word diff, §3 the flow state machine, §4 the usage wording and §5 the
gate file.

## How it plugs in

```
EditorToolbar sparkle slot (P1)
   └─ EditorAction "ai" (createAiEditorAction)            registered by composition/aiWiring.tsx
        run(ctx) ─► AiFlow.start(ctx, subjectAiAllowed)   modal opens (AiFlowHost)
                    sheet → [age] → [key] → [consent] → running → preview → Apply
                    resolves { doc, message }  ─────────► P1 runEditorAction:
                                                           validate, "Before AI change" version,
                                                           save, show, 8-second exact Undo
```

- The **editor isn't modified**. The AI is added through P1's documented action hook.
- The flow is a **React Native Modal**, mounted once under AppDataProvider, rather than pushed routes. The
  note screen underneath keeps its focus and editing session (no "left the note" save, no reload), and no
  note data or keys go into navigation parameters.
- Closing the modal from any step (the X button, Android back, iOS swipe-down) **cancels**: `start()` rejects
  with `AppError('cancelled')` and the note screen shows nothing for it.

## Public interface (`@/modules/aiui`)

| Export | What it is |
|---|---|
| `createAiUi(deps)` | Builds `{ engine, gate, reports, flow, activeEngine, isDemo, saveKey, wipeSecrets, forget }` from plain ports: `keyVault`, `fetchFn`, `logger`, `ids`, `aiFile(name)`, `isDev`. Composition calls it once. |
| `createAiEditorAction({ flow, subjectAiAllowed })` | The `ai` action for the sparkle slot. `subjectAiAllowed` must fail closed. |
| `AiFlowHost({ flow, ports })` | The modal. `ports.openLink(url)` uses P1's link opener (it confirms first and opens outside the app); `ports.clipboard` is optional. |
| `AiSettingsScreen({ aiui, keyVault, ports, subjects, isDev })` | Me → AI (route `src/app/ai/settings.tsx`). |
| `createAiFlow`, `visibleActions`, `AI_CARDS_ENABLED` | The controller (testable without React). Flashcards and Quiz me stay hidden until P4c (Q5 = B). |
| `createGateStore` → `GateStore` | `ai/gate.json`: age result, consent **per provider, per data kind (`text`, `image`) and per version**, default provider, Demo AI switch. Implements the engine's `AiGatePort`. |
| `checkCanSend(gate, { provider, kind, aiAllowed? })`, `assertCanSend` | The one send check for any kind (§5.1): provider accepts the kind (**photos: Groq only**), subject switch, 18+, consent for that kind at the catalog's current version. **P5 calls it with `kind: 'image'`** before its "Match a look" vision pass (approved by Rey, Nov 1). |
| `ConsentStep({ provider, kind, ... })` | The consent screen. `kind="image"` shows the catalog's `imageConsent` wording ("Send photos to Groq?"). P5 shows it and stores the answer with `gate.giveConsent(p, version, 'image')`. |
| `createReportsStore` | `ai/reports.json`: local reports, metadata only, at most 50. |
| `checkYear`, `checkMonth`, `checkDay`, `recheckDueAt` | The §1 age rule, exported so **P4 (Groq Whisper, also 18+) uses the same gate**. |
| `wordDiff`, `buildDiffRows`, `usageText`, `progressText`, `errorView` | Pure helpers (tested). |

### Files on the phone (`documents/ai/`, all deleted by Delete all data)

| File | Holds | Never holds |
|---|---|---|
| `usage.json` | Request and token counts per provider per day (P3a) | Keys, note text, prompts, answers |
| `gate.json` (v2) | `{adult, checkedAt}`, `{version, at}` per data kind and provider, the default provider, the Demo AI switch | The birth year, month or day |
| `reports.json` | Action, provider, model, prompt version, time, reason, an optional 200-character comment | Note text, AI output |

Keys are kept only in the Keychain / Keystore (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`), and
only in the `ai.groq.apiKey` / `ai.mistral.apiKey` slots.

## Rules this module enforces

- **18+ (Rey, Nov 1).** The prompt is the birth year, with an empty field and no mention of the cut-off
  before the answer (Q2 = A). The month is asked only in the boundary year (Q3 = A), and the day only when
  the birth month is the current month. Only the yes/no result and the date are stored. An under-18 answer
  sticks; a re-check is offered after one year (Q4 = A). Under-18s see one calm panel that points to Beautify
  Lite, with no nagging.
- **Consent kinds are separate** (Lead, Nov 1): a text "yes" never authorises photos, and a photo "yes"
  never authorises note text. Each kind has its own catalog wording and version.
- **Consent (Apple 5.1.2(i)).** Before the first send to a provider, the consent screen shows that
  provider's `recipient`, `dataSent`, `purpose`, `dataUse` (plus Mistral's training opt-out steps), age rule,
  privacy and terms. "Yes, send to Groq" stores `{version}`; a new catalog version asks again. The engine
  refuses to send without it.
- **Key.** It's asked at the first AI action, never during onboarding. The field is hidden (secure entry, no
  autocorrect or autofill). The **candidate** key is tested before it's stored, so a rejected key never
  replaces a working one. After it's saved it's shown only masked (`gsk_…Ab3x`), and a copied key is cleared
  from the clipboard.
- **Nothing leaves the phone until** the subject switch, age, key and consent checks all pass (§3.1), and the
  engine checks them again.
- **The preview is plain text.** The AI's words go into `<Text>`, never HTML. Stale changes are locked off.
  Apply goes through `applyProposal` (P3a) and then P1's `runEditorAction` (schema, cloud caps, version,
  exact Undo).
- **Empty-document guard** (P1 bug, Nov 1): the action refuses to run if the editor hands over a document
  with no text while the stored note has text, and Apply refuses a result that would remove all the text.
- **Groq only through the gate:** in release builds the Groq transcriber gets **no key at all** until P4
  adds an `audio` consent kind (`transcriptionAllowed` in `services.ts`), because a text consent must not
  authorise audio. Development builds keep the P0 spike screens working.
- **Demo AI** works only in development builds, is labelled DEMO on every screen, sends nothing, and keeps its
  usage in memory.

## How to extend

- **New action:** add it to P3a's `ACTION_DEFS`, add an icon and description to `actionsMeta.ts` and a string
  to `strings.ts`, and put it in `ACTION_ORDER`. Card and quiz kinds stay hidden while `AI_CARDS_ENABLED` is
  false.
- **New provider:** add it to P3a's catalog. The wizard, consent screen, badges, usage line and settings all
  read from the catalog.
- **Translation:** add a table and call `setAiStrings()`, alongside core's `setStrings()`.

## Tests

`src/modules/aiui/__tests__` (no network; `fetch` throws in every flow test):

| File | Covers |
|---|---|
| `ageRule.test.ts` | Boundary years, month and day, Feb 29, re-check date |
| `gateStore.test.ts` | Fails closed, versioned consent, serial writes, `forget()` |
| `reportsStore.test.ts` | Strict schema, cap, comment never logged |
| `flow.test.ts` | Full first run; under 18; consent "Not now"; blocked subject; rejected, malformed and unchecked keys; Cancel; invalid output; rate limit with switch provider; offline; bad key; partial accept; Discard; empty; Report; hidden actions; Explain with a selection; one flow at a time; the key and note text never logged |
| `diff.test.ts` | Word diff (§2) and display text; usage, wait and progress wording; one next step for every error kind |
| `demo.test.ts` | Every demo answer passes its real schema; impossible in release builds |
| `screens.test.tsx` | Age form (neutral, empty, boundary), key form (hidden, clipboard), action sheet, consent fields, preview toggles and stale lock, the modal from open to apply, cancel, the minor panel, the DEMO label |
| `settings.test.tsx` | Masked key only; Remove, Withdraw, the subject switch; Demo AI switch in dev only |
| `security.test.ts` | No fetch, console, eval, HTML/WebView, navigation params or hard-coded URLs in the aiui source |

Composition: `src/composition/__tests__/aiWiring.test.ts` runs the action through P1's `runEditorAction` with a
real SQLite store. It checks that "Before AI change" is saved, Undo restores the exact note with the same ids,
Cancel saves nothing, and Delete all data removes both keys and the whole ai folder.
