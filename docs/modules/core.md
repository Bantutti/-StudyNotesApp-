# core

**Purpose:** platform-neutral building blocks every module uses. Import from `@/core`
(UI kit from `@/core/ui`).

**Public interface**
- Errors and results: `AppError(code, userMessage)`, `errorCode()`, `userMessage()`, `Result<T>`,
  `ok`, `fail`, `parseWith(schema, data, what)`, `parseOrThrow`, `utf8Length`.
- Logging: `createLogger({ sink, minLevel })`, `consoleSink(isDev)`, `memorySink()`,
  `redactFields`, `scrubString`. Use short event names and numeric/boolean fields:
  `logger.info('export.pdf_done', { ms: 412 })`.
- Document model: `noteDocSchema`, `validateNoteDoc`, `parseNoteDocJson`, `checkDocLimits`,
  `ensureBlockIds`, `listBlockIds`, `countBlocks`, `SAMPLE_NOTE`, `makeLongSample`, `DOC_LIMITS`.
- Results log: `createResultsStore({ file, ids, device, logger })`, `resultsToMarkdown`,
  `spikeResultSchema`, `SPIKES`.
- Utilities: `mean/median/percentile/mad/round`, `base64ToBytes/bytesToBase64`, `escapeHtml`,
  `safeHref`, `createIdGenerator(randomBytes)`.
- Platform adapters: `expoTextFile(...)`, `getDeviceInfo()`, `isExpoGo()`, `secureRandomBytes`.
- UI kit (`@/core/ui`): `Screen`, `Card`, `Button`, `Row`, `Stat`, `Banner`, `Body`, `Verdict`,
  `SampleBadge`, `Segmented`, `ui` tokens.

**How to extend**
- New node or mark type: add it to `document/schema.ts` (schema + `DocNode` type), to the TipTap
  extensions in `editor-web/src`, to `export/html.ts` and `export/docx.ts`, then add tests in all three.
- New sensitive field name: extend `SENSITIVE_FIELD` in `redact.ts` and add a test.
- Never log objects, errors or user text; pass error codes (`errorCode(e)`).
