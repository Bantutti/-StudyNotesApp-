# P2a security review

Scope: `firebase/` (rules, schemas, deletion module, admin script, tests) and `docs/backend/`. Reviewed Nov 1, 2026. Sections are **§S.x**.

**Result: no open High or Critical issues.** One High (a dependency) and one Medium (a correctness and availability bug) were found and fixed during the phase.

## §S.1 Threat model (backend)

| Asset | Threats | Controls |
|---|---|---|
| Notes, cards, review history, recordings, files | Another user reading or changing them; a stolen token used from a script | Deny by default; `owner == auth.uid` on every read and write; owner-filtered and limit-bounded queries; verified email required; App Check planned (§S.4) |
| Data integrity for sync | Malformed or oversized docs; forged timestamps; stale offline writes overwriting newer data; review logs edited | Exact key sets, types, lengths and enums in the rules; server timestamps; a `rev` counter; create-only review logs; zod on load for JSON contents |
| Account deletion | Leftover data; a second device re-uploading during deletion; orphans after Auth deletion | A "deletion in progress" lock blocks writes; the profile is deleted last, so after that no write can pass; tested end to end |
| Cost and abuse | Scripted bulk reads and writes against the project | Page limit of 500; size caps; Spark hard caps for now; App Check and budget alerts planned |
| Storage | Script uploads (HTML, SVG), huge files, untracked files, cross-user writes | Per-folder content types and size caps; every upload must match an asset doc (owner, exact path, exact size, type); no custom metadata |
| Secrets | Keys committed to the repo | No secrets needed (emulators use `demo-*`); the admin script uses ADC only; gitleaks scan; `.gitignore` covers service-account files |

## §S.2 Controls, by rule

1. §S.2.1 **Identity:** `request.auth != null && email_verified == true`. This blocks anonymous and unverified accounts entirely.
2. §S.2.2 **Ownership:** `resource.data.owner == uid()` for get, list, update and delete; `request.resource.data.owner == uid()` on create; owner is immutable. `users/{uid}` is reachable only by that uid. Listing profiles is denied.
3. §S.2.3 **Top-level collection specifics:** ids share one namespace, so the rules require entity ids of at least 16 characters, and the app must generate them with at least 80 random bits (LIMITS §L.2). A read of a missing id is denied, the same as a foreign id, which leaks nothing.
4. §S.2.4 **Validation:** exact keys (`hasOnly` plus `hasAll`), types, length caps, enums, patterns, list caps (tags and examDates are checked item by item).
5. §S.2.5 **Lifecycle:** `created` and `updated == request.time`; `id`, `owner` and `created` are immutable; `rev` = old + 1; docs can't be created as tombstones; hard delete only for tombstones or during deletion.
6. §S.2.6 **Review logs:** create-only; an update is always denied; re-sending the same id is denied; delete only during account deletion or after the card is tombstoned (the card is checked to belong to the same user); `reviewedAt` is at most 5 minutes ahead of server time.
7. §S.2.7 **Account state:** every write needs an existing, non-deleting profile (`userActive()`).
8. §S.2.8 **Storage:** owner-only; folder allowlist; filename pattern; content-type allowlist (no SVG or HTML); 0 < size ≤ cap; no custom metadata; the asset doc must match; no uploads during deletion.

All of these are covered by tests: **586 tests in 9 files**, including 491 generated cases that check zod and the rules agree.

## §S.3 Known gaps (by design, documented and tested)

The agreement test asserts these exact gaps, so if the rules ever close one, the test asks for this list to be updated.

- §S.3.1 **Inside JSON strings** (document, segments, definitions, settings): rules only cap the length. Anyone who can write a doc can store malformed JSON **in their own doc only**. **Required:** the sync module validates with the zod schemas on load and quarantines anything invalid, never rendering it.
- §S.3.2 **`recordings.bookmarks` items:** rules check the list size (≤ 500) but not each item. Same mitigation as above.
- §S.3.3 **Rate limits and quotas:** not possible in rules (see APP_CHECK_AND_BUDGET.md §2).

## §S.4 Findings by severity

| # | Severity | Finding | Status |
|---|---|---|---|
| F-1 | **High** (dev/test dependency) | `@grpc/grpc-js` < 1.13.6 under `firebase@13.1.0` → `@firebase/firestore` (GHSA-m9gg-hp2v-232j: getAuthContext can treat unauthorized certificates as authorized; GHSA-f596-whhp-79r4: error-message leak). npm audit counted 5 High through this one root. | **Fixed:** npm `overrides` pins 1.14.7. All tests pass. Note: the React Native build of Firestore uses WebChannel, not grpc-js, but P0's `npm audit` will flag the same thing. See MERGE_NOTES. |
| F-2 | **Medium** | **zod 4.6.7 measures `.max()` in code points; Firestore rules measure UTF-16 units.** Strings with emoji could pass app validation and then fail at sync, getting stuck in the queue. Found by the limits probe test. | **Fixed:** `utf16String()` is used for every capped string; generated emoji mutations prevent regressions. P0 and P1 must adopt it (MERGE_NOTES). |
| F-3 | Medium | No App Check yet, so a scripted client with a valid verified account could make many requests (cost, not data exposure). | **Open, tracked for P2 (app side) and the real project.** Not High, because the rules still confine every request to the caller's own data, and Spark's hard caps bound cost while on Spark. |
| F-4 | Medium (accepted) | No true rate limits or per-user quotas in rules. | Accepted on Spark (hard caps). Revisit before Blaze: budget alerts are required; a function-based quota is optional. |
| F-5 | Moderate (dev-only, accepted) | 7 moderate npm audit entries remain, all inside `firebase-tools`, from two root advisories: `minimatch` < 11.0.1 in its v3, v5 and v6 consumers (GHSA-g3hv-75wg-m249, a ReDoS-style DoS through glob patterns) and `@opentelemetry/core` < 2.8.0 under `@google-cloud/pubsub` (GHSA-8988-4f7v-96qf, unbounded memory in baggage parsing). | Accepted: dev tooling only, never shipped in the app, and not reachable with attacker input (glob patterns come from our own config; the pubsub client isn't used). No upstream fix in firebase-tools 15.34.2. The glob, uuid and newer minimatch advisories were fixed with overrides. Recheck every phase. |
| F-6 | Low | Existence oracle and id squatting in top-level collections: a create succeeds only for unused ids, and someone could claim an id another user later picks. | Accepted: ids carry at least 80 random bits (unguessable). The sync module can regenerate an id if a create is denied for an unknown reason. |
| F-7 | Low | Rules don't validate inside JSON strings or bookmark items (§S.3.1, §S.3.2). | Accepted: this only affects the writer's own docs; zod on load is required. |
| F-8 | Low | `deletionRequestedAt` can be cleared (cancel) after a partial deletion. | Accepted: the UI must not offer cancel after step 2 (ACCOUNT_DELETION §A.2.1). |
| F-9 | Info | Firebase ID tokens stay valid up to 1 hour after the Auth user is deleted. | Mitigated: writes require the profile, which is deleted before Auth; the user's own data is already gone. |
| F-10 | Info | Each write costs 1 extra read (profile check); each upload costs 2 Firestore reads (cross-service rules). | Accepted cost of the deletion lock and file tracking (LIMITS §L.11). |
| F-11 | Info | npm reports install scripts for `re2`, `protobufjs` and `@firebase/util` "not covered by allowScripts". | Dev-only. Consider `npm ci --ignore-scripts` in CI once tests confirm the emulators don't need them. |

## §S.5 Gate evidence

| Check | Result |
|---|---|
| Rules and emulator tests | `npm test` → 9 files, **586 passed**, 0 failed |
| Typecheck | `npm run typecheck` (TypeScript 6.0.3, strict) → clean |
| Lint | `npm run lint` (ESLint 10, typescript-eslint strict type-checked, `no-console` in src) → clean |
| Dependency audit | `npm run audit` (fails on high or critical) → pass; `npm run audit:all` → 0 critical, 0 high, 7 moderate (F-5, dev-only, accepted) |
| Secret scan | gitleaks 8.30.1 `dir` over firebase/ (without node_modules) and docs/ → **no leaks found** |
| Supply chain | exact versions (`save-exact`), `package-lock.json`, `engine-strict`; the Java 21 JDK and gitleaks were downloaded with SHA-256 verified against the publishers' checksums |

## §S.6 OWASP MASVS notes (backend side)

The MASVS controls are mostly app-side (P1 to P7). P2a contributes to:
- **MASVS-AUTH:** authorization lives on the server (rules), never in the client; verified email; deletion requires a recent login.
- **MASVS-PRIVACY:** data minimization (no email or device paths in Firestore); complete deletion path; no logging of content (`no-console` lint rule in src).
- **MASVS-NETWORK:** n/a for P2a (the Firebase SDKs use TLS; App Check planned).
