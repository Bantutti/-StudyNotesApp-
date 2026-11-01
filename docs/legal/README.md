# docs/legal and docs/store: C1 compliance and store prep

> **DRAFT. Not legal advice.** Track C (Dev Engineer II), phase C1, Nov 1, 2026. Markdown only, plus the small static site in `web/` (see `web/README.md`). No app code.

## Start here

| If you want to… | Read |
|---|---|
| Know what the app collects and where it goes | `DATA_INVENTORY.md` (the single source, IDs D1–D19) |
| Read the user-facing legal texts | `PRIVACY_POLICY.md`, `TERMS_OF_USE.md`, `ACCOUNT_DELETION_PAGE.md` |
| See what needs a lawyer or a P7 check | `LEGAL_REVIEW_CHECKLIST.md` (L-1…L-23, V-1…V-23) |
| Check a fact's source | `SOURCES.md` (all read 2026-11-01) |
| Fill Google Play forms | `../store/PLAY_APP_CONTENT.md`, `../store/PLAY_DATA_SAFETY.md`, `../store/AGE_RATINGS.md` §1 |
| Fill App Store forms | `../store/APPLE_PRIVACY_LABELS.md`, `../store/AGE_RATINGS.md` §2 |
| Run the closed test | `../store/CLOSED_TEST_PLAN.md`, `../store/closed-test-tracker.csv` |
| Write the store listing | `../store/STORE_LISTING.md` (includes the name check) |
| Know what Rey must do (free vs paid) | `../store/REY_SETUP.md` |
| Know what C1 delivered | `PHASE_REPORT_C1.md` |
| Show the legal texts inside the app (P2b) | `../../web/app-docs/` (generated; see `web/README.md` §5) |

## Conventions

- **Placeholders** `{{APP_NAME}}`, `{{DEVELOPER_LEGAL_NAME}}`, `{{CONTACT_EMAIL}}`, `{{SITE_BASE_URL}}`, `{{EFFECTIVE_DATE}}` are filled in one place, `web/site.config.json`. Nothing is guessed: Rey supplies the values (decisions Q2, Q3, Q5).
- **Markers:** `[LAWYER L-n]` and `[VERIFY-AT-P7 V-n]` in the texts; their meaning is in `LEGAL_REVIEW_CHECKLIST.md`. The site build removes them from the public pages.
- **Flags:** `FILE_SYNC`, `VISION_AI`, `APP_CHECK` in `web/site.config.json` switch the parts of the privacy policy that depend on undecided features.
- **Scope rule:** the documents describe the **v1 launch scope**. Nothing unbuilt is described as working: every app claim carries a `V-` marker and is checked in P7 before the `draft` status becomes `final`.
