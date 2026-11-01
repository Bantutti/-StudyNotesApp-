# ai

**Purpose.** The AI engine, with no screens. It handles the student's own (bring-your-own) key
for free AI providers. It turns an AI action on a note into a **proposal** (block-by-block changes,
flashcard drafts or quiz drafts) that the student reviews before anything changes. Then it
applies the accepted blocks and offers exact undo. P3b adds the screens (action sheet, key wizard,
diff preview, usage display).

Maths and algorithms: [`src/modules/ai/ALGORITHMS.md`](../../src/modules/ai/ALGORITHMS.md)
(code comments cite it as §X.Y).

## Providers (checked on official pages, 2026-11-01)

| | Groq (default) | Mistral |
|---|---|---|
| Cost | **Free plan, $0, no card.** Only the Developer plan (pay per token) costs money | **Free mode, no card.** Only pay-as-you-go usage beyond the included amount costs money |
| Models | `openai/gpt-oss-120b`, falls back to `openai/gpt-oss-20b` when rate limited | `mistral-small-latest` |
| Free limits | Per model: 30 requests/min, 1,000/day, 8,000 tokens/min, 200,000 tokens/day | Not published; see your Mistral Limits page |
| Your notes | Not kept by default; may be kept up to 30 days for abuse or outage checks; Zero Data Retention available | **May be used for training on free mode unless you turn it off**: Admin panel → Privacy → "Anonymous improvement data" (see below) |
| Age | 18+ in Groq's terms | Business use; minors only with a parent's or guardian's consent |
| Key page | console.groq.com/keys | console.mistral.ai |

**Turning off Mistral training.** Admin panel → **Privacy** (left-hand menu) → switch off **"Anonymous improvement data"**. This is a separate toggle from Mistral's Vibe product, so turning off one does not turn off the other. Source: Mistral Help Center, "Can I opt out of my input or output data being used for training?", dated Sep 3, 2026 (https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training). This path replaced the older "Admin panel → API → Privacy" one; the catalog's `dataUse.privacyStep` and `dataUse.privacyStepSource` carry the new path and the article's URL and date.

**AI is an 18+ feature in this app** (Rey, Nov 1, Q1 = A). P3b asks for the **birth year** (no default,
a neutral prompt; changed from "I'm 18 or older" on Nov 1, 3:00 AM) and stores only yes/no plus the date
(`docs/modules/aiui.md`). The key wizard and consent screen show each provider's `ageRule` and `dataUse`
from `PROVIDER_CATALOG`.
Under-18s keep Beautify Lite and rule-based cards. Free limits are stored with `checkedOn` and must
be re-checked in P7.

**Consent (Plan F5; Apple App Review Guideline 5.1.2(i)).** Each provider has a `consent` block:
`required: true`, a `version`, the `recipient`, exactly what is sent (`dataSent`) and why (`purpose`).
P3b's consent screen shows these plus `dataUse`, and stores an explicit per-provider "yes" together
with the version. The engine calls `gate.hasConsent(provider, consent.version)` before every run
and refuses to send (`consent_required`) without it. Bump `consent.version` whenever any of that
wording changes, so students are asked again.

## Public interface (`@/modules/ai`)

**Keys (from P0, extended).** `PROVIDERS` (`groq`, `mistral`), `PROVIDER_INFO`, `normalizeKey`,
`maskKey`, `isProvider`, `createKeyVault(store)` (`get`, `set`, `remove`, `has`), `expoSecretStore`.
The slots are `ai.groq.apiKey` (unchanged from P0, shared with voice/Whisper) and
`ai.mistral.apiKey`.

**Engine.**

```ts
const ai = createAiEngine({
  keyVault, fetchFn: fetch, logger, ids, usageFile,   // usageFile: TextFilePort, e.g. expoTextFile('ai', 'usage.json')
  gate: { isAdultConfirmed, hasConsent },             // hasConsent(provider, consentVersion): P3b's consent screen
  isOnline,                                           // optional
});

const proposal = await ai.run(
  { action: 'beautify', provider: 'groq', doc, scope: { kind: 'note' }, aiAllowed: subject.aiAllowed },
  { signal, onProgress },                             // Cancel button + "part 2 of 3", "waiting 4 s"
);
await ai.testKey('mistral');                          // { ok: true } | { ok: false, reason: 'invalid_key' | 'missing_key' }
await ai.testKey('groq', signal, pasted);             // P3b: tests a NEW key without storing it
ai.usage.reload();                                    // P3b: drop the cached file after Delete all data
await ai.usage.today('groq');                         // requests, tokens, failures, limits + checkedOn
ai.providers;                                         // ProviderInfo[]: labels, URLs, minAge, dataUse, free tier
```

**Actions (`AI_ACTIONS`, `ACTION_DEFS`).** Each has a versioned prompt and a zod output schema.

| Action | Result |
|---|---|
| `beautify`, `clarify`, `simplify`, `translate`, `cleanTranscript`, `expand` | Block changes (replace / delete / insert) |
| `summarize`, `keyTerms`, `explain` (needs a selection) | Inserted blocks after the scope |
| `flashcards` | `CardDraft[]`: `{ type: basic/reversed/cloze, front, back, source: 'ai', sourceBlockId }` (P2a card fields) |
| `quiz` | `QuizDraft[]`: mcq (3 to 5 choices, `answerIndex`) or short answer |

Cloze format (proposal for P4c): `front` is the sentence with exactly one `{{hidden phrase}}`;
`back` is empty or a hint.

**Proposals.** These are pure functions, with no network.
- `findStaleChanges(currentDoc, proposal)`: change ids whose target changed since the proposal
  (block-level rebase, Q7). P3b shows them turned off.
- `applyProposal(currentDoc, proposal, acceptedChangeIds, ids)` returns `Result<ApplyResult>` with
  the new doc, an `undo` record, applied/stale ids, and `changedBlockIds` / `newBlockIds` /
  `removedBlockIds` (P4c marks cards "Source changed"). It never returns a broken note.
- `undoApply(currentDoc, undo)` gives back the exact previous note with the same block ids, or
  `stale` if the note changed after apply (then use version history).
- `proposal.snapshotReason` ("Before Beautify") is the label for P1's version snapshot.

**Errors.** Every failure is an `AiError` (it extends core's `AppError`) with a `kind`:
`missing_key`, `invalid_key`, `rate_limited` (`scope` minute/day, `retryAfterMs`), `offline`,
`timeout`, `provider_error`, `too_large`, `invalid_output`, `cancelled`, `consent_required`,
`age_required`, `blocked`, `empty_scope`, `stale`, `invalid_input`, `internal`. The message names
the chosen provider (Plan §9.6), e.g. "This key was rejected by Groq."

**Testing helper.** `createFakeProvider(id, script)` is a scripted adapter. Pass it as
`providers: { groq: fake }` in tests or a developer screen.

## Rules this module enforces

- The key is read from secure storage per request and sent only in the `Authorization` header to
  a fixed HTTPS host (`api.groq.com/openai/v1`, `api.mistral.ai/v1`). It never goes to our backend,
  logs, the usage file or a proposal (tested on every failure path).
- The AI sees **aliases** (`u1`, `u2`), never real block ids. Unknown or duplicate refs, changes
  to read-only blocks and forbidden ops are rejected. One automatic re-ask, then `invalid_output`
  with nothing changed (Q6).
- AI text can only contain **bold**, *italic*, ==highlight==, ~~strike~~, ++underline++ and line
  breaks. **No links, HTML or styles can come from the AI.** A link survives only if its exact
  text survives, and its href then comes from the student's own note.
- Blocks the AI leaves out are kept. Rewritten blocks keep their id and every non-shape
  attribute. Results always pass core's `validateNoteDoc`.
- Requests stay under Groq's free 8,000 tokens/min. Long notes are split into chunks of about
  2,500 tokens (at most 8 chunks), with pacing between them. A 429 is auto-retried only when
  Retry-After is 10 s or less (Q9); otherwise the engine falls back to the next model, then stops
  with a friendly message.

## Block id attribute

This module never reads or writes the id attribute by name. It uses core's `listBlockIds` and
`ensureBlockIds`, so it follows P1's choice. **Tested with `attrs.blockId`** (P0 core).

## How to extend

- **New provider.** If it's OpenAI-compatible, add it to `PROVIDERS`/`PROVIDER_INFO`
  (`keyFormat.ts`), add a catalog entry (fixed `apiBase`, models, limits with `checkedOn`, age rule,
  data use) and an `OpenAiCompatibleConfig`. The transport's host allow-list comes from the
  catalog automatically. If it isn't OpenAI-compatible, implement `ChatProvider` (`complete`,
  `testKey`).
- **New action.** Add a zod schema (strict objects, required or nullable fields) in
  `actions/schemas.ts`, an entry in `ACTION_DEFS` with a prompt version, and a builder in
  `proposal/build.ts` that enforces the rules zod can't express. Bump `promptVersion` whenever the
  wording changes.

## Tests

`npm test` runs `src/modules/ai/__tests__` (no network): transport, document, proposal, engine,
adapters (including the key-leak test), usage, and the P0 key tests.

### Live check (Rey, Windows, with your own free keys)

This is opt-in and skipped unless `AI_LIVE=1`. Your key is typed into a **masked** prompt, kept
only in this PowerShell window's memory, and never written to a file. Run it from the project
folder:

```powershell
$s = Read-Host "Paste your Groq key" -AsSecureString
$env:GROQ_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$s = Read-Host "Paste your Mistral key" -AsSecureString
$env:MISTRAL_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$env:AI_LIVE = "1"
npx jest --selectProjects app src/modules/ai/__tests__/live.test.ts --verbose
Remove-Item Env:GROQ_API_KEY, Env:MISTRAL_API_KEY, Env:AI_LIVE
```

You can skip one provider by not setting its key; its tests show as "skipped". Expected
result: every live test shows a green check (✓). One full run uses about 8 requests per provider,
well inside the free limits. Never paste a key into chat, a file or a commit.
