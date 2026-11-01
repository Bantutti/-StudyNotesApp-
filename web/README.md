# web/ — the public legal and support site

> **DRAFT.** Owned by Track C (C1). The source files go to the private repo. Only the **contents of `web/public/`** are copied to the public repo `Bantutti/studynotes-site`, which GitHub Pages serves (decision Q1, Nov 1, 2026). Setup steps: `docs/store/REY_SETUP.md` §1.

## §1 What's here

| Path | What it is |
|---|---|
| `content/index.md`, `content/support.md` | Home and Support page text (the Support page is Apple's required "Support URL") |
| `../docs/legal/PRIVACY_POLICY.md`, `TERMS_OF_USE.md`, `ACCOUNT_DELETION_PAGE.md` | The legal text. Written once, used for both the review copy and the web page |
| `site.config.json` | Placeholder values (`APP_NAME`, `DEVELOPER_LEGAL_NAME`, `CONTACT_EMAIL`, `EFFECTIVE_DATE`, `SITE_BASE_URL`), flags (`FILE_SYNC`, `VISION_AI`, `APP_CHECK`) and `status` (`draft` or `final`) |
| `build-site.mjs` | The generator (Node 24, no npm packages) |
| `style.css` | The only stylesheet (system fonts, no downloads) |
| `test/build-site.test.mjs` | Unit tests (Node's built-in test runner) |
| `public/` | **Generated.** Don't edit by hand; run the build |
| `app-docs/` | **Generated.** Self-contained Markdown copies of the privacy policy, terms and deletion page for the app's Me screen (§5) |

**Public URLs** once Pages is on (they go into Play Console and App Store Connect):

| Page | URL (replace `{{SITE_BASE_URL}}`, likely `https://bantutti.github.io/studynotes-site`) |
|---|---|
| Privacy policy | `{{SITE_BASE_URL}}/privacy.html` |
| Terms of use | `{{SITE_BASE_URL}}/terms.html` |
| Account deletion | `{{SITE_BASE_URL}}/delete-account.html` |
| Support | `{{SITE_BASE_URL}}/support.html` |

## §2 How the build works (cross-referenced from the code as §2.x)

- **§2.1 Internal blocks.** Text between `<!-- internal -->` and `<!-- /internal -->` (review notes, draft banners) never reaches the web page. An unclosed block stops the build.
- **§2.2 Conditional blocks.** `<!-- if FILE_SYNC -->` … `<!-- endif -->` (or `if not`) keeps or drops text using the flags. Example: Cloud Storage needs the Blaze plan, so file-sync text appears only when `FILE_SYNC` is `true`. Unknown flags and nesting stop the build.
- **§2.3 Review markers.** `[LAWYER L-n]` and `[VERIFY-AT-P7 V-n]` are removed. Their meaning lives in `docs/legal/LEGAL_REVIEW_CHECKLIST.md`.
- **§2.4 Placeholders.** `{{NAME}}` is replaced from `site.config.json`. An empty value stays visible on the page, so a missing name or email is obvious. A filled `CONTACT_EMAIL` becomes a mailto link. An unknown placeholder name stops the build.
- **§2.5 Markdown subset.** Headings, paragraphs, single-level lists, tables, quotes, bold, italic, inline code and links. All text is HTML-escaped first, so a document can't inject HTML or script.
- **§2.6 Links.** Links between the docs (`PRIVACY_POLICY.md`) become page links (`privacy.html`). Only `https`, `http`, `mailto`, our own pages and `#anchors` are allowed. Every page link is checked to exist.
- **§2.8 In-app copies.** The same steps §2.1–§2.4 produce `app-docs/privacy.md`, `terms.md` and `delete-account.md`: no HTML comments, no review markers, no build directives, links between them rewritten to the in-app names, and a "Draft" line at the top while `status` is `draft`. A link to any other local file stops the build, because the app bundles only these three.
- **§2.7 Template.** One shared page layout with a strict Content-Security-Policy (`default-src 'none'; style-src 'self'`): no scripts, frames, forms or outside requests. Pages show a "Draft" notice while `status` is `draft`.

## §3 Commands (Windows PowerShell, from the repo root)

```powershell
node --version                                # needs v24 (already installed for the app)
node --test web/test/build-site.test.mjs      # run the tests
node web/build-site.mjs                       # rebuild web/public after any text change
node web/build-site.mjs --check               # confirm web/public and web/app-docs match the sources
node web/build-site.mjs --release             # refuses while status is draft or a placeholder is empty
```

To preview, open `web\public\index.html` in your browser (double-click it in File Explorer).

## §4 Publishing to GitHub Pages

> **ON HOLD** (Rey, Nov 1, 2026, 2:45 PM): no publishing for now. Don't create the public repo, enable Pages or push `web/public/` anywhere public. Preview locally only (§3).

See `docs/store/REY_SETUP.md` §1. In short: fill `site.config.json`, run the build, then copy **everything inside `web/public/`** (including the hidden `.nojekyll` file) to the root of `Bantutti/studynotes-site`. Agents can push it once the repo exists and the GitHub app has access.

## §5 In-app copies for the Me screen (P2b)

P2b bundles **`web/app-docs/*.md`**, not the raw `docs/legal/*.md` files. The raw files hold internal review notes, `[LAWYER …]` / `[VERIFY-AT-P7 …]` markers, `<!-- if … -->` blocks and links to files the app doesn't ship. The generated copies are plain, self-contained Markdown:

| In-app file | Source |
|---|---|
| `app-docs/privacy.md` | `docs/legal/PRIVACY_POLICY.md` |
| `app-docs/terms.md` | `docs/legal/TERMS_OF_USE.md` |
| `app-docs/delete-account.md` | `docs/legal/ACCOUNT_DELETION_PAGE.md` |

Rules for the app side: render the Markdown as plain text formatting only (no raw HTML); treat links to `privacy.md`, `terms.md` and `delete-account.md` as in-app navigation; open `https://` and `mailto:` links in the system browser or mail app. After any legal text changes, run `node web/build-site.mjs` and re-copy the three files (or import them at build time). `--check` fails if they're stale.

