# MERGE_NOTES: P3a → shared docs, core and composition

P3a pushed only `src/modules/ai/**` and `docs/modules/ai.md`. The rest of this file is text and
small changes for the Lead (or the owning thread) to apply when merging. Nothing here is required
for P3a's code to work.

## 1. Suggested core changes (not made; core belongs to P1)

- `ErrorCode`: add `'cancelled'` and `'consent'`. Today `AiError` maps `cancelled` → `internal` and
  `consent_required` / `age_required` / `blocked` → `permission_denied`. After the change, update
  the `CORE_CODE` table in `src/modules/ai/errors.ts` (2 lines).
- `redact.ts`: optional extra rule for Mistral-style keys (opaque alphanumerics). The ai module
  doesn't depend on it.

## 2. `docs/ARCHITECTURE.md`

Replace the `ai` row with:
> `ai` | AI engine: BYOK keys (Groq, Mistral), provider port with an OpenAI-compatible adapter,
> fixed-host transport (timeouts, retries, TPM pacing), 11 actions with versioned prompts and zod
> output schemas, alias-based block-id preservation, proposals with apply/rebase/exact undo, card
> and quiz drafts in P2a fields, local usage meter | modules/ai.md

Add to "Key decisions":
> AI edits are proposals, never direct writes. The AI sees block aliases, not ids. Output can only
> be schema data with five inline marks, so no links or HTML can come from the AI. Undo is exact
> only while the note is unchanged; otherwise use version history.

## 3. `docs/SECURITY.md`

Add the P3a findings table (PHASE_REPORT §4, P3a-S1 to S7) and these threat-model rows: prompt
injection through note content; AI output tampering with block ids; key leakage via logs or error
bodies; free-tier training on notes (Mistral opt-out, Gemini not used).

## 4. `docs/CHANGELOG.md`

```
## P3a — AI engine module (Nov 2026)
- AI engine behind src/modules/ai: Groq (gpt-oss-120b → 20b fallback) and Mistral adapters, fake adapter.
- Provider catalog with 18+ rule, data use, free limits (checked 2026-11-01).
- 11 actions with versioned prompts and zod output schemas; card/quiz drafts in P2a fields.
- Alias-based block-id preservation, proposals with block-level rebase and exact undo.
- Fixed-host HTTPS transport: timeouts, cancel, retries (429 ≤ 10 s once), TPM pacing.
- Local usage meter (JSON file, 30 days, no content).
- 95 new tests (85 always-on incl. the key-leak test on every failure path, 10 opt-in live tests).
```

## 5. `docs/TESTING_ON_DEVICE.md`

- **Section 1:** "Free AI keys (optional, 18+ only): Groq (free plan, no card) and Mistral (free
  mode, no card). Upgrading either to a paid plan costs money; the app never needs that."
- **Section 7 (AI features):** add the "Live check" block from `docs/modules/ai.md`. Add: "For
  Mistral, open Admin panel → Privacy (left-hand menu) and switch off 'Anonymous improvement data' before
  using it with your notes. It is separate from the Vibe toggle. (Mistral Help Center, dated Sep 3, 2026.)"
  The on-device AI steps come with P3b's screens.
- **Section 8 (checklist), P3a:**
  1. `npm run verify` → all green (206 tests, 10 skipped).
  2. Live check with your Groq key → 5 Groq tests ✓.
  3. Live check with your Mistral key → 5 Mistral tests ✓.
  4. Live check with no keys → only the "rejects a made-up key" tests run, and they pass.
  5. Security: search the test output for your key; it must not appear.
- **Section 9 (troubleshooting):** "Live test says 401 with your real key → re-copy it from the
  provider's key page (no spaces). Mistral 400 on Beautify → report it to the P3a thread (schema
  field names). 429 → you used the free limit; wait or try tomorrow."

## 6. Composition wiring (for P3b)

```ts
import { createAiEngine } from '@/modules/ai';
ai: createAiEngine({
  keyVault, fetchFn: a.fetchFn, logger, ids,
  usageFile: expoTextFile('ai', 'usage.json'),
  gate: aiGate,          // P3b: isAdultConfirmed() + hasConsent(provider, consentVersion) from settings
  isOnline,              // optional
}),
```
