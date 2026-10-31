# Security

Phase: **P0 (spike lab)**. Updated every phase. Rule: security first; when unclear, choose the
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

## 3. Backend rules

**None in P0: there is no backend.** From P2: Firestore and Storage rules deny by default and allow
only `request.auth.uid == resource owner`, with emulator tests for allowed and denied cases, input
schema validation on the server, App Check, size limits and rate limits.

## 4. Findings and fixes (P0)

Severity scale: High / Medium / Low / Info. **No open High or Medium issue.**

| ID | Severity | Finding | Status |
|---|---|---|---|
| P0-S1 | Medium | First paste sanitizer (regex) left `<script>` bodies and closing tags in place. CSP and schema parsing already stopped execution, but the layer was weaker than intended. | **Fixed:** replaced with an inert-DOM allowlist sanitizer; tests cover nested/malformed markup. |
| P0-S2 | Medium | `npm audit`: 12 moderate advisories (glob, minimatch) in Expo CLI/config tooling. | **Fixed:** `overrides` to glob 14.0.3 and minimatch 11.0.3; prod audit 0, bundles still build. |
| P0-S3 | Low | zod probes `new Function` for its JIT; inside the WebView the CSP blocks it but logs a violation. | **Fixed:** `z.config({ jitless: true })` before any schema runs in the WebView. |
| P0-S4 | Low | Editor CSP uses `style-src 'unsafe-inline'` to inject pack and font CSS at runtime. | **Accepted for P0:** CSS cannot exfiltrate anything (no network: `default-src 'none'`, images/fonts only `data:`), and injected CSS is generated from validated packs. Revisit with constructable stylesheets or nonces in P1. |
| P0-S5 | Low | Recordings and the results log are stored unencrypted inside the app sandbox. | **Open, P1 decision:** OS sandbox protects them; backups disabled on Android. Decide SQLCipher (expo-sqlite `useSQLCipher`) and file protection classes in P1. |
| P0-S6 | Low | 7 low advisories (deepmerge via Jest). Dev tooling only, never shipped; no patched version exists. | **Accepted:** re-check every phase. |
| P0-S7 | Low | Upstream pack bundle `engine.js` `key()` inserts highlighter meanings into HTML without escaping (mitigated by the validator's character rules). | **Not carried over:** the TypeScript port escapes everything. Fix the reference engine if it is reused. |
| P0-S8 | Info | The secretlint preset did not flag a synthetic (random) PEM block during the scanner self-test. | **Covered:** the export script rejects `*.pem`/`*.key`/keystores by name and any `BEGIN … PRIVATE KEY` text. |
| P0-S9 | Info | Audio sent to Groq leaves the device (third party). | **By design with consent:** dialog on every upload. P3 adds a persistent privacy setting and data-handling notes per provider. |

**Bugs found by tests (not security):**
- The Groq adapter's file-name check rejected the app's own recording names (`…T101500.m4a`,
  uppercase `T`): every real transcription would have failed. Fixed and tested.

## 5. OWASP MASVS check (P0)

| Group | Status in P0 |
|---|---|
| MASVS-STORAGE | Key in Keychain/Keystore; no secrets in files or logs; backups off (Android). Recording encryption: P1 decision (P0-S5). |
| MASVS-CRYPTO | No custom crypto. CSPRNG (expo-crypto) for ids. |
| MASVS-AUTH | No accounts in P0 (P2). |
| MASVS-NETWORK | HTTPS only, single fixed provider host, no cleartext. Certificate pinning: evaluate in P7. |
| MASVS-PLATFORM | WebView fully hardened (section 2); no deep-link handlers act on data yet; minimal permissions. |
| MASVS-CODE | Pinned deps, lockfile, audits, input validation at every boundary, no dynamic code in the WebView. |
| MASVS-RESILIENCE | P7 (release hardening). |
| MASVS-PRIVACY | Metrics-only results, redacting logger, consent before third-party upload, no analytics. |

## 6. Per-phase security gate

Run before calling a phase done: `npm run verify` (types, lint, tests, secret scan, prod audit),
`npm run audit:all`, `npm run bundle:check`, review of the phase's diff against this document, and
the export script's secret checks. Record new findings in section 4.
