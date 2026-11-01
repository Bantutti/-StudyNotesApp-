# MERGE_NOTES: P3b → main

For the Lead when merging PR #7 (P3b AI screens).

## 1. Order and conflicts

- This branch was cut from `phase/p1-core-app` at **8855b26**. Merge P1 (PR #5) first, then merge `main` into
  `phase/p3b-ai-ui`, re-run `npm run verify`, and the PR diff shrinks to P3b only.
- **P2b runs in parallel** and edits the same shared files. P3b's changes are small and self-contained, so a
  conflict should only need both sides kept:
  - `src/composition/services.ts`: the `ai`/`aiui` fields, `Adapters.aiFile`, the two `appData` wrappers
    (`wipeFiles`, `wipeSecrets`), `APP_FOLDERS` (exported, now with `'ai'`). If P2b also changes
    `wipeSecrets` (for example to sign out), keep both: `aiui.wipeSecrets()` must still run.
  - `src/app/_layout.tsx`: `<AiWiring />` must stay **inside** `Navigator` (that is, under AppDataProvider).
  - `src/app/(tabs)/me.tsx`: the AI row sits after "Your data". P2b's account and sync rows can go anywhere.
  - `src/core/strings.ts`: 3 `me.*` keys after `me.deleteAllAsk`.
  - `docs/*`: P3b only appended sections (ARCHITECTURE row and decisions, SECURITY §4d, CHANGELOG top
    entry, TESTING_ON_DEVICE §7 and §8 P3b, README folder map).

## 2. For later briefs

- **P4 (voice):** Groq Whisper is an 18+ service too, and its slot `ai.groq.apiKey` is shared. Gate
  transcription with `services.aiui.gate.isAdultConfirmed()` (and the same consent screen: reuse
  `ConsentStep`, or add a transcription consent version to the catalog). The age helpers are exported from
  `@/modules/aiui`.
- **P4 (voice), required:** release builds give the transcriber **no key** today. To ship transcription:
  add `'audio'` to `CONSENT_KINDS` and an `audioConsent` block to each catalog entry (in `consentBlock`),
  show `ConsentStep kind="audio"`, then replace `transcriptionAllowed` with
  `checkCanSend(gate, { provider: 'groq', kind: 'audio' })`.
- **P5 (style packs, vision pass behind a flag):** before sending a reference photo, call
  `checkCanSend(services.aiui.gate, { provider, kind: 'image' })` from `@/modules/aiui`. If it reports
  `consent_required`, show `<ConsentStep provider={p} kind="image" … />` and store a yes with
  `gate.giveConsent(p, consentBlock(p, 'image').version, 'image')`. If it reports `age_required`, the
  student hasn't passed the 18+ check (send them through the AI panel, or reuse `AgeForm`). A text consent
  never satisfies this. The image wording promises "no notes"; strip photo metadata (EXIF, location)
  before sending, and if you then state that in the wording, bump `imageConsent.version`.
- **P1's empty-document fix:** once it lands, keep P3b's guard anyway (defence in depth; test
  `aiWiring.test.ts` "P1 empty-document bug guard").
- **P4c (review):** turn on `AI_CARDS_ENABLED` in `src/modules/aiui/flow/controller.ts`, add a preview for
  `proposal.cards` / `proposal.quiz`, and save through the cards repo. Cloze format: P3a `docs/modules/ai.md`.
- **P2b (sync):** `documents/ai/*.json` is **device-local and never synced** (the age result and consent are
  per device by design). The P2b sync must not upload them.
- **P7:** re-check the catalog's free limits and terms (`checkedOn` 2026-11-01), the store answers for
  "AI note sending" (C1), and the legal review of the self-declared age gate (P3b-S3).
