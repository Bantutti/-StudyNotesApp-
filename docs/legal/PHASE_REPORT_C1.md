# PHASE REPORT: C1 compliance and store prep (Track C)

**Worker:** Dev Engineer II (thread cmvwr8kje03p007adke044tgh) · **Date:** 2026-11-01 · **Branch:** `phase/c1-compliance` → PR into `main` (not merged) · **Status:** all deliverables written as **DRAFTS**, pending Rey's placeholder values, the legal review (Q12) and the P7 check.

## 1. What was built

| Area | Files |
|---|---|
| Data inventory (single source, IDs D1–D19) | `docs/legal/DATA_INVENTORY.md` |
| Privacy policy (plain English, RA 10173, honest data flows) | `docs/legal/PRIVACY_POLICY.md` |
| Terms of use (13+, AI 18+, AI can be wrong) | `docs/legal/TERMS_OF_USE.md` |
| Account deletion web page (Play's web link requirement) | `docs/legal/ACCOUNT_DELETION_PAGE.md` |
| Legal review and P7 checklist (22 L-items, 21 V-items, cross-track changes) | `docs/legal/LEGAL_REVIEW_CHECKLIST.md` |
| Sources (every official page used, read 2026-11-01) | `docs/legal/SOURCES.md` |
| Play: App content and Data safety answers | `docs/store/PLAY_APP_CONTENT.md`, `docs/store/PLAY_DATA_SAFETY.md` |
| Apple privacy labels | `docs/store/APPLE_PRIVACY_LABELS.md` |
| IARC and Apple age ratings, AI gate description | `docs/store/AGE_RATINGS.md` |
| Closed test kit (schedule, invite, opt-in steps, tasks, survey, production application drafts, tracker) | `docs/store/CLOSED_TEST_PLAN.md`, `docs/store/closed-test-tracker.csv` |
| Store listings and name check | `docs/store/STORE_LISTING.md` |
| Rey's setup list, free vs paid | `docs/store/REY_SETUP.md` |
| Public site: generator, tests, content, config, CSS, generated pages | `web/` |
| Merge notes for shared docs | `docs/legal/MERGE_NOTES.md` |

## 2. Decisions applied (Rey, Nov 1, 2026, 3:00 AM)

Q1 GitHub Pages from public repo `Bantutti/studynotes-site` (not created yet) · Q2 Rey as individual controller, `{{DEVELOPER_LEGAL_NAME}}` · Q3 new app Gmail, `{{CONTACT_EMAIL}}` · Q4 email deletion within 7 days · Q5 working name "Noted" in `{{APP_NAME}}`, package name not fixed · Q6 birth year with no default; Apple Age Assurance No · Q7 Play 13–15/16–17/18+, Apple override 13+ · Q8 AI sends collected, optional, not shared · Q9 no analytics or crash reporting · Q10 Philippines first · Q11 closed test at the P7 beta, recruiting around P6 (P4 optional) · Q12 low-cost legal review before production.

## 3. How to view and run (Windows PowerShell, repo root, Node 24, no npm install)

```powershell
node --test web/test/build-site.test.mjs   # 15 tests
node web/build-site.mjs --check            # web/public matches the sources
node web/build-site.mjs                    # rebuild after editing any text
start web\public\index.html                # preview the site in your browser
```

## 4. Checks run (gate for a docs phase)

| Check | Result |
|---|---|
| Unit tests (`node --test web/test/build-site.test.mjs`) | **15 of 15 passed** |
| Site up to date (`node web/build-site.mjs --check`) | **Up to date**, 7 files |
| Release guard (`--release`) | **Refuses as intended**: status `draft`; empty `CONTACT_EMAIL`, `DEVELOPER_LEGAL_NAME`, `EFFECTIVE_DATE` |
| Review markers leaking to public pages | **None** (test plus grep) |
| Marker register | Every `L-`/`V-` used is defined in the checklist, and every defined item is used |
| Spelling (codespell 2.x) | 4 hits, all accepted: a developer's name "Parth" (×2) and two exact quotes from Google ("re-used", "indicat[es]") |
| External links (49 URLs) | 42 returned 200 to curl. 5 privacy.gov.ph pages returned 403 to curl (bot protection) but **200 in a real browser**. 2 `bantutti.github.io` links return 404, which is expected until Rey creates the site repo |
| Secret scan (gitleaks v8.30.1, checksum verified) | **No leaks found** |
| Dependency audit | Not applicable: no dependencies (Node built-ins only) |

## 5. Security review (site and docs)

| Severity | Finding | Status |
|---|---|---|
| — | Public pages have no scripts, cookies, analytics, external fonts or requests; CSP `default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'`; `referrer: no-referrer` | Built in |
| — | All Markdown is HTML-escaped before formatting; link targets allow-listed; unknown placeholders, flags or unclosed internal blocks stop the build | Built in, tested |
| Low | GitHub Pages can't send HTTP security headers (only meta CSP; no `frame-ancestors`). Pages hold no secrets or forms, so clickjacking risk is negligible | Accepted |
| Low | The filled tester tracker holds personal data | Mitigated: only an empty template is in the repo; `CLOSED_TEST_PLAN.md` §8 says to keep the filled copy in Rey's private Drive and delete it after approval |
| — | No open high-severity findings | — |

## 6. Findings that matter for other tracks and for Rey

1. **"Noted" clashes on both stores** with Digital Workroom's "Noted" (App Store Editors' Choice, about 5M downloads claimed, same headline feature: notes time-stamped to a lecture recording). Apple allows one app per name per localization. Recommendation: choose a distinctive name (Studyleaf looked free) before the permanent package name is set. Rey is confirming (`STORE_LISTING.md` §1).
2. **Tombstoned notes keep their content in Firestore** (P2a design). P2b should erase content on tombstone so "deleted from the cloud" is true (`V-7`).
3. **The review log `device` field is a synced device identifier**, so both store forms declare it (Play "Device or other IDs", Apple "Device ID").
4. **Firebase Auth may store Google/Apple display names and photo URLs**; P2b should clear them or we declare Name (`V-5`).
5. **Groq's "not for consumer use" term and Mistral's business-only API** are the top legal questions (`L-14`, `L-20`).
6. Play Console accounts need the owner to be 18+, and personal accounts need **device verification** with the Play Console mobile app. Play review of production access usually takes **seven days or less** (official page).

## 7. Known limits

- Every text is a **draft**: not legal advice, not yet checked against a built app. P7 runs the V-checks, then `status` becomes `final`.
- IARC's exact questions are visible only inside Play Console; `AGE_RATINGS.md` §1 is a copy-along sheet by topic.
- Apple's Declared Age Range page renders only with JavaScript and wasn't read in full (not needed for decision Q6 A).
- Store name search is not a trademark search.

## 8. What's next

1. Rey: create `Bantutti/studynotes-site`, the app Gmail, and send the legal name, email and final app name (`REY_SETUP.md` §1–3).
2. Track C: fill `web/site.config.json`, rebuild, push `web/public/` to the site repo, confirm the URLs.
3. Lead: pass the §6 cross-track items to P2b, P3b and P4c; merge this PR after review.
4. Before P6: Play developer account and verification. P6: recruiting. P7: closed test, V-checks, legal review results applied.

## 9. Export

Zip `StudyNotesApp-C1-compliance-20261101.zip` in `exports/`, Drive folder `StudyNotesApp/C1-compliance`. **SHA-256:** `bb58363603ab4884bc852abb26ae1004d3b47029e95f67bc60167a619bf28795` (92,466 bytes, 42 entries, per-file `MANIFEST.sha256` inside). Drive: folder `StudyNotesApp/C1-compliance` (id `13gI3U3p_Ql_FiGRg79eYh8kuNm14hIDQ`), zip id `1JL9KsmqvpP27qDEkSMe6VRQkDVGrudIe` (downloaded back, SHA-256 matches), PHASE_REPORT.md id `1H8ucWUWrWZk3Chzt5-C5Rheix9rqX2dA`. The copy of this report inside the zip predates the checksum (a file can't contain its own zip's checksum).
