# Security

Phase: **P1 (core app)**, with the P2a backend and P3a AI engine merged. Updated every phase. Rule: security first; when unclear, choose the
stricter option and say so.

## 1. Threat model (P0)

**Assets**
- Note content (in P0 a built-in sample plus whatever the tester types; not persisted).
- Voice recordings (stored in the app's private document folder).
- The user's AI provider key (Groq).
- The user's device and other apps on it.

**Entry points in P0**
- Text typed or **pasted** into the editor (pasted HTML is untrusted).
- Messages crossing the **WebView bridge** (both directions).
- **Groq API responses** (untrusted network data).
- Bundled **style packs** today; imported or AI-generated packs in P5 (untrusted).
- Local files the app reads back (results log, recordings).

**Adversaries considered**
- Hostile content pasted from the web (script injection, tracking pixels, `javascript:` links).
- A compromised or malicious response from a third-party API.
- Network attackers (public Wi-Fi).
- Other apps on the device; a lost or shared phone; device backups.
- Supply-chain compromise of npm dependencies.
- A future malicious style pack or AI output (P3/P5): the schemas are already built for this.

**Out of scope until later phases:** accounts, cloud data and backend rules (P2), AI text features
(P3), release signing and tamper resistance (P7).

### Additions in P1

**New assets:** the local notes database (notes, subjects, versions, settings), the search index, version
history. **New entry points:** typed and pasted note content (now persisted), search queries, templates,
deep links into the app (Expo Router), link taps inside notes, editor actions (Beautify now, AI in P3b),
typing diagnostics (developer menu). **New adversaries considered:** a lost or shared phone (local data),
content crafted to break the editor or the database (injection, oversized or malformed documents), and a
note link that leads to a phishing site.

**P2a (backend) and P3a (AI) threat model rows:** see `docs/backend/SECURITY_REVIEW.md` §S.1 (another
user's data, sync integrity, account deletion, cost and abuse, Storage, secrets) and these AI rows: prompt
injection through note content; AI output tampering with block ids; key leakage via logs or error bodies;
free-tier training on notes (Mistral opt-out, Gemini not used).

## 2. Controls in place

### Editor WebView (MASVS-PLATFORM)
| Control | Detail |
|---|---|
| No network | CSP `default-src 'none'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'` |
| One pinned script | `script-src 'sha256-<hash>'` of the single inline bundle. No `unsafe-inline` scripts, no `unsafe-eval`. A unit test recomputes the hash and checks the page has exactly one script. |
| No navigation | `onShouldStartLoadWithRequest` allows only `about:blank`/`about:srcdoc`; `originWhitelist` likewise; links never open. |
| No file or storage access | `allowFileAccess`, `allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs` false; `domStorageEnabled` false; `incognito`; cache off; no third-party cookies. |
| No windows, no mixed content | `setSupportMultipleWindows` and `javaScriptCanOpenWindowsAutomatically` false; `mixedContentMode: never`; geolocation off; link previews and data detectors off. |
| Debugging | WebView inspection only in development builds (`webviewDebuggingEnabled={__DEV__}`). |
| Validated bridge | Size cap before `JSON.parse` (6 MB), versioned discriminated-union schema in both directions, unknown types rejected, documents and packs re-validated by their own schemas. Only data crosses: never HTML, CSS or script. |
| No dynamic code | zod runs `jitless` inside the WebView so it never calls `new Function`. The bundle contains no `eval`, `fetch`, `XMLHttpRequest` or `WebSocket` (checked during the P0 review). |

### P1 controls

| Area | Control |
|---|---|
| Local database (MASVS-STORAGE) | SQLite in the app's private storage. `PRAGMA secure_delete = ON` (freed pages are overwritten), FTS5 secure-delete, WAL checkpointed and the database file deleted on **Delete all data**, which also deletes recordings, the results log and the Groq test key. No encryption at rest in P1 (decision Q5): see finding P1-S6. |
| SQL injection | Every statement uses `?` placeholders. The only interpolations are integers from code (`user_version`) and fixed identifiers (savepoint and table names); `ORDER BY` comes from a whitelist. |
| Search injection | Input becomes quoted prefix terms of letters and digits only (`"osmo"*`), max 8 terms of 40 chars; FTS5 operators, quotes and column filters can't be injected (tested with hostile inputs). Snippet markers are private-use characters, stripped from indexed text, rendered as plain `<Text>` parts, never HTML. Queries are never logged. |
| Deleted data | 8-second Undo, then the text, title, tags, versions and search rows are wiped; only a tombstone stays for sync. Going to the background ends the Undo window at once. |
| Synced text | Names, titles and tags are cleaned (control, zero-width and bidi-override characters removed) and measured in UTF-16 units like the Firestore rules (`syncedText`, P2a MERGE_NOTES §6.2); the cloud contract test proves local rows pass P2a's schemas. |
| Document integrity | Every save goes through `prepareDocForSave`: schema v2 with structure rules, non-null unique `blockId` on every block, the cloud size caps. Loading validates again. The editor page normalizes and validates before sending, so a rejected edit is shown in a banner instead of being lost. |
| Links in notes (Apple age rating, MASVS-PLATFORM) | The page never navigates: CSP without network, `onShouldStartLoadWithRequest` allows only the local document, new windows off, link clicks cancelled. A tap posts `openLink`; native re-validates (http, https, mailto; no whitespace or control characters), shows "Open link?" with the real host (a `user:pass@` disguise is stripped from the display), and only then calls `Linking.openURL` (the OS browser, outside the app). |
| Page previews | Read-only WebViews with JavaScript **off**, the export CSP (no scripts, no network) and blocked navigation. |
| Templates | Validated data: closed set of block kinds, strict objects, text without `< > { }`, `url(`, `http(s):`, `javascript:`, `data:` or `@import`; fresh block ids per note. |
| Editor actions (P3b hook) | Output is validated (schema, structure, ids, caps) before anything is saved; a "Before …" version is saved first; Undo restores the exact previous document. Actions never touch storage or the WebView. |
| Editor bridge | New messages are strict zod schemas (block ids by pattern, command enum, no HTML). **Typing diagnostics** carry metadata only: event and input types, lengths, flags, offsets; printable keys become "char"; the schema rejects any text field and single-character keys. Off by default, developer menu only. |
| Developer menu | Hidden behind 7 taps on the version; every `/dev` route redirects home unless enabled, so a deep link can't open it. |
| Logging | Redaction also drops titles, terms, queries, search, snippets, previews, tags, links and card text fields. |
| Accessibility of security prompts | Dialogs are native Alerts with plain wording ("This opens example.com in your browser, outside NotedPo."). |

### Untrusted content
- **Pasted HTML:** parsed in an inert `DOMParser` document; script/style/iframe/object/embed/form/
  svg/math/img/media elements removed; unknown elements unwrapped to text (allowlist); `on*`,
  `style`, `srcset` and similar attributes dropped; `href`/`src` kept only for http(s)/mailto.
  ProseMirror then keeps only our schema's node and mark types. Image/file paste is ignored.
- **Document schema:** allowlisted nodes and marks, link protocols restricted, unknown attributes
  stripped, size/depth/node limits.
- **Export HTML:** every string escaped, links re-checked, CSP `script-src 'none'` and no network
  inside the print WebView.
- **Style packs:** strict schema (unknown fields rejected), enums/hex/fonts/clamped numbers only,
  free text cannot contain `< > { } ; url( http: javascript: @import`. Per-pack output is CSS
  variables only; component CSS is static. WCAG contrast rules enforced.
- **Groq responses:** schema-validated and bounded (text 500 KB, 100k words); error bodies are never
  read into messages or logs.
- **Results log:** every line re-validated on read; invalid lines skipped.

### Secrets and the AI key (MASVS-STORAGE, MASVS-CRYPTO)
- The Groq key is stored only via expo-secure-store with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
  (Keychain item on iOS, Keystore-encrypted storage on Android): readable only while the phone is
  unlocked and never included in backups or device transfer.
- The key is read per request and sent only to the constant host `https://api.groq.com` in the
  `Authorization` header. It is never sent to us, never written to files, analytics or logs, and the
  UI shows only `gsk_…abcd`.
- Key input field: `secureTextEntry`, autocorrect, autofill and spell-check off.
- The project contains **no secrets**. `.env` is gitignored and unused in P0; `.env.example` has no
  values. Firebase config arrives in P2 (public web config only; never service-account keys in the app).

### Logging and privacy (MASVS-PRIVACY)
- One structured logger. Event names must be short identifiers. Fields whose names suggest content
  or secrets (`key`, `token`, `text`, `content`, `transcript`, `note`, `url`, `path`, `email`, ...)
  are replaced with `[redacted]`; string values are scrubbed for key shapes (Groq, OpenAI-style,
  Google, Bearer tokens, JWTs, long base64, emails) and truncated. Objects are never forwarded.
- Release builds log only warnings and errors to a no-op sink (no console output).
- Results hold metrics only. Device info uses the hardware model, never the user-set device name.
- Uploading audio to Groq always shows a consent dialog naming the third party.
- Android `allowBackup: false`; dangerous permissions not used are blocked in `app.json`
  (`READ/WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`, `READ_PHONE_STATE`).
- Microphone is requested only when the user taps Record, with a plain-language reason.

### Files
- Recordings: `<documents>/recordings/rec-<timestamp>.m4a`; names are app-generated and deletion
  only accepts names matching that pattern. Exports: app cache `exports/`, app-generated names only.

### Network (MASVS-NETWORK)
- Only HTTPS endpoints exist in code (Groq). No `http://` URLs. Release builds block cleartext
  traffic by default (Android target SDK, iOS ATS); development builds allow it only for the local
  Metro dev server.

### Supply chain (MASVS-CODE)
- Exact versions in `package.json` (`save-exact`), `package-lock.json` committed, `npm ci` in docs.
- npm 11 blocks dependency install scripts by default; the project needs none.
- `npm audit` every phase; `overrides` pin patched `glob`/`minimatch` for Expo's CLI tooling.
- Secret scan (secretlint recommended preset + Groq/Google patterns) every phase, plus the export
  script's own filename and content checks before any zip is written.

## 3. Backend rules (P2a, merged)

The rules live in `firebase/` and are tested on the local emulators (601 tests at the merge, including 491
generated cases that check zod and the rules agree). Summary: **deny by default**; verified email required;
`owner == uid` on every read and write; queries must filter `where owner == uid` with `limit ≤ 500`; exact
key sets and size caps; server timestamps; a `rev` conflict check (old + 1); append-only review logs;
Storage content-type and size caps checked against an asset doc; no writes while account deletion runs.

**Known gaps (by design):** rules can't validate inside the JSON strings (document, segments, definitions,
settings) or enforce rate limits, so **zod on load is mandatory** in P2b's sync module (quarantine anything
invalid, never render it). Details: `docs/backend/SECURITY_REVIEW.md` §S.2 and §S.3.

## 4. Findings and fixes (P0)

Severity scale: High / Medium / Low / Info. **No open High or Medium issue.**

| ID | Severity | Finding | Status |
|---|---|---|---|
| P0-S1 | Medium | First paste sanitizer (regex) left `<script>` bodies and closing tags in place. CSP and schema parsing already stopped execution, but the layer was weaker than intended. | **Fixed:** replaced with an inert-DOM allowlist sanitizer; tests cover nested/malformed markup. |
| P0-S2 | Medium | `npm audit`: 12 moderate advisories (glob, minimatch) in Expo CLI/config tooling. | **Fixed:** `overrides` to glob 14.0.3 and minimatch 11.0.3; prod audit 0, bundles still build. |
| P0-S3 | Low | zod probes `new Function` for its JIT; inside the WebView the CSP blocks it but logs a violation. | **Fixed:** `z.config({ jitless: true })` before any schema runs in the WebView. |
| P0-S4 | Low | Editor CSP uses `style-src 'unsafe-inline'` to inject pack and font CSS at runtime. | **Accepted (P0, re-checked in P1):** CSS cannot exfiltrate anything (no network: `default-src 'none'`, images/fonts only `data:`), and injected CSS is generated from validated packs. Revisit with constructable stylesheets or nonces in P1. |
| P0-S5 | Low | Recordings and the results log are stored unencrypted inside the app sandbox. | **Decided in P1 (Q5): no encryption at rest in P1**, see P1-S6. |
| P0-S6 | Low | 7 low advisories (deepmerge via Jest). Dev tooling only, never shipped; no patched version exists. | **Accepted:** re-check every phase. |
| P0-S7 | Low | Upstream pack bundle `engine.js` `key()` inserts highlighter meanings into HTML without escaping (mitigated by the validator's character rules). | **Not carried over:** the TypeScript port escapes everything. Fix the reference engine if it is reused. |
| P0-S8 | Info | The secretlint preset did not flag a synthetic (random) PEM block during the scanner self-test. | **Covered:** the export script rejects `*.pem`/`*.key`/keystores by name and any `BEGIN … PRIVATE KEY` text. |
| P0-S9 | Info | Audio sent to Groq leaves the device (third party). | **By design with consent:** dialog on every upload. P3 adds a persistent privacy setting and data-handling notes per provider. |

**Bugs found by tests (not security):**
- The Groq adapter's file-name check rejected the app's own recording names (`…T101500.m4a`,
  uppercase `T`): every real transcription would have failed. Fixed and tested.

## 4b. Findings and fixes (P1)

Severity scale: High / Medium / Low / Info. **No open High or Medium issue.**

| ID | Severity | Finding | Status |
|---|---|---|---|
| P1-S1 | Medium | P0's block-id pass kept the first id in document order, so a copy pasted **above** its original took the original's id; cards and audio anchors would have followed the wrong text. Enter at the start of a line also moved the text to a new id, and turn-into dropped ids. | **Fixed:** smart-paste and in-place restore (`blockIdPlugin.ts`); 41 editor tests cover every case. |
| P1-S2 | Medium | Loading a note entered the undo history, so **Undo right after opening could rewind the load and blank the page** (which autosave would then store). Found by tests. | **Fixed:** `loadDoc()` resets history; regression test. |
| P1-S3 | Medium | Deleting the only block let the id pass move the deleted block's id onto the filler paragraph (a card would point at the wrong block). Found by tests. | **Fixed:** an id is restored only onto a block with the same text (or the same text minus an input-rule marker). |
| P1-S4 | Low | One read path (tags from storage) counted length in code points, not UTF-16 units (P2a F-2). | **Fixed:** `syncedText` everywhere; emoji boundary tests against P2a's `utf16String`. |
| P1-S5 | Low | The log redactor didn't treat titles, terms, queries or tags as sensitive. | **Fixed;** tested. |
| P1-S6 | Low | The local database is not encrypted at rest. | **Accepted for P1 (decision Q5):** private app storage plus the phone's own encryption; Android backups off; deleted text wiped; iPhone backups include app data, like Apple Notes. SQLCipher needs a development build (no Expo Go on iPhone without a paid account). Revisit in P7. |
| P1-S7 | Low | Editor CSP keeps `style-src 'unsafe-inline'` (P0-S4). | **Accepted:** no network in the page; injected CSS comes only from validated packs and static menu CSS. |
| P1-S8 | Low | Opening links inside the app would count as unrestricted web access (Apple age rating) and expose users to in-app phishing pages. | **Fixed (C1):** links open only in the OS browser after a confirm showing the real host. |
| P1-S9 | Low | An edit the app's schema rejects (e.g. a pasted ragged table) would have been dropped silently. | **Fixed:** the page normalizes (pads tables, turns oversized ones into lines), validates before sending, and the screen shows a banner on failure. |
| P1-S10 | Info | The bundled TipTap link plugin contains `window.open`. | **Not reachable:** `openOnClick: false` (plugin not registered), new windows disabled, navigation blocked. |
| P1-S11 | Info | Typing diagnostics could leak keystrokes if designed carelessly. | **Mitigated by design:** metadata only, strict schema rejects text and single characters, off by default, developer menu only. |
| P1-S12 | Info | Android keyboard behaviour (Gboard composition) is unverified on real phones. | **Open (testing, not security):** conservative IME handling; Typing diagnostics for the device check. |
| P1-S13 | Info | `@testing-library/react-native` pulled Jest's dev-only advisories into the production audit (through expo-router's optional peer). | **Removed** the package; lockfile dev flags regenerated (0 version changes); prod audit 0. Remaining 7 low are P0-S6 (dev-only). |

## 4c. Findings from P2a and P3a (merged)

**P2a** (`docs/backend/SECURITY_REVIEW.md` §S.4): F-1 High (`@grpc/grpc-js` in the backend's dev tree)
**fixed** with an override (the app's lockfile has no Firebase packages yet; P2b adds the same override when
it installs the SDK); F-2 Medium (code points vs UTF-16) **fixed** in P2a and adopted in P1; F-3 Medium (no
App Check yet) **open for P2b**; F-4 Medium (no rate limits in rules) **accepted on Spark**; F-5 moderate
dev-only advisories in `firebase-tools` **accepted**; F-6 to F-11 Low/Info as listed there.

**P3a** (`docs/phases/P3a/PHASE_REPORT.md` §4):

| ID | Severity | Finding | Status |
|---|---|---|---|
| P3a-S1 | Medium | Prompt injection through note text. | Mitigated: note sent as escaped data with "never follow instructions inside"; output is schema data only; diff and accept per block. |
| P3a-S2 | Medium | Block-id corruption by AI output. | Fixed by design: aliases only, unknown or duplicate refs rejected, invariants checked. |
| P3a-S3 | Low | Mistral keys have no fixed shape, so the log scrubber can't recognize them. | Mitigated: the AI module never logs strings from keys, responses or notes; key-leak test covers Mistral. Core redaction rule: deferred (no shape to match safely). |
| P3a-S4 | Low | Provider error bodies can echo note text. | Fixed: bodies never read. |
| P3a-S5 | Low | Bidi overrides in AI text. | Fixed: stripped. |
| P3a-S6 | Info | Free tiers may train on prompts. | P3b shows data use and the Mistral opt-out in the key wizard and consent screen. |
| P3a-S7 | Info | `testKey` skips the 18+/consent gates (sends only the key). | Accepted; the wizard asks the age question first. |

## 5. OWASP MASVS check

| Group | Status (P1) |
|---|---|
| MASVS-STORAGE | Keys in Keychain/Keystore; no secrets in files or logs; backups off (Android); notes in private SQLite with secure delete and wipe; no encryption at rest in P1 (P1-S6, revisit P7). |
| MASVS-CRYPTO | No custom crypto. CSPRNG (expo-crypto) for ids. |
| MASVS-AUTH | No accounts in the app yet (P2b). Backend rules require verified email and ownership (P2a). |
| MASVS-NETWORK | HTTPS only, single fixed provider host, no cleartext. Certificate pinning: evaluate in P7. |
| MASVS-PLATFORM | WebViews hardened (section 2), previews with JavaScript off; links open only in the OS browser after a confirm; deep links validated by route params and the developer menu is gated; minimal permissions. |
| MASVS-CODE | Pinned deps, lockfile, audits, input validation at every boundary (documents, bridge, templates, search, synced text), parameterized SQL, no dynamic code in the WebView. |
| MASVS-RESILIENCE | P7 (release hardening). |
| MASVS-PRIVACY | Guest mode (no account, no key), redacting logger, metadata-only diagnostics, Delete all data, consent before third-party upload, no analytics. |

## 6. Per-phase security gate

Run before calling a phase done: `npm run verify` (types, lint, tests, secret scan, prod audit),
`npm run audit:all`, `npm run bundle:check`, review of the phase's diff against this document, and
the export script's secret checks. Record new findings in section 4.
