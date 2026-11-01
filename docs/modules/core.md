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

## Added in P1
- `limits.ts`: P2a's cloud caps mirrored (ids, text lengths in UTF-16 units, document 600,000
  characters and 900,000 bytes), `utf16String()`.
- `document/storage.ts`: `prepareDocForSave()` (schema, non-null unique `blockId` on every block,
  cloud caps, usage ratio), `emptyNoteDoc()`, `EMPTY_DOC_JSON`.
- `document/text.ts`: `extractTextBlocks()` (search rows), `countWords()`, `firstLine()`.
- `BLOCK_ID_ATTR = 'blockId'` and `getBlockId(node)`: the one way to read a block id (decision Q7).
- Schema v2 and `checkDocStructure()` (see editor.md).
- `color.ts`: WCAG contrast, `ensureContrast()`, `solidColors()`.
- `strings.ts`: every user-facing string, `t()` and `tCount()` (plan 9.8, Filipino later).
- `core/ui/tokens.ts`: plan 9.5 chrome tokens, light and dark, with role-based contrast fixes.
- Redaction also drops titles, terms, queries, tags, snippets, previews, links and card text.
