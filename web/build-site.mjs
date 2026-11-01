#!/usr/bin/env node
/**
 * build-site.mjs — turns the legal Markdown into the public static website.
 *
 * WHY THIS EXISTS
 *   The privacy policy, terms and deletion page are written ONCE, as Markdown in
 *   docs/legal/ (reviewable in the private repo, with review markers). The public
 *   website (GitHub Pages, decision Q1, Nov 1 2026) must show the same text
 *   WITHOUT the internal review notes. Copying by hand would let the two drift
 *   apart, and a store reviewer reading an outdated policy is a real risk.
 *   So this script is the only way the public pages are produced.
 *
 * WHAT IT DOES (in order, for each page; section numbers refer to web/README.md)
 *   1. Removes internal blocks between  <!-- internal -->  and  <!-- /internal -->   (§2.1)
 *   2. Keeps or drops  <!-- if FLAG --> ... <!-- endif -->  blocks using the flags
 *      in web/site.config.json (FILE_SYNC, VISION_AI, APP_CHECK)                    (§2.2)
 *   3. Removes review markers such as [LAWYER L-3] and [VERIFY-AT-P7 V-7]          (§2.3)
 *   4. Fills {{PLACEHOLDERS}} from site.config.json; empty values stay visible     (§2.4)
 *   5. Converts a small, strict subset of Markdown to HTML                         (§2.5)
 *   6. Rewrites links between the docs (PRIVACY_POLICY.md -> privacy.html)         (§2.6)
 *   7. Wraps the result in one HTML template with a strict Content-Security-Policy (§2.7)
 *   8. Also writes clean, self-contained Markdown copies of the three legal texts
 *      into web/app-docs/ for the app's Me screen (P2b bundles these)            (§2.8)
 *
 * USAGE (Windows PowerShell or any terminal, from the repo root; needs Node 24, no npm install)
 *   node web/build-site.mjs            build into web/public/
 *   node web/build-site.mjs --check    fail if web/public/ is out of date (used in review)
 *   node web/build-site.mjs --release  build, but fail on any empty placeholder or "draft" status
 *   node --test web/test/build-site.test.mjs   run the unit tests
 *
 * SECURITY NOTES
 *   - All Markdown text is HTML-escaped BEFORE formatting is applied, so nothing
 *     in a document can inject HTML or script into the pages.
 *   - Only https:, http:, mailto:, same-site .md/.html links and #anchors are
 *     allowed; anything else (for example javascript:) makes the build fail.
 *   - The pages carry no scripts, no cookies, no external fonts and no trackers.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Paths. Everything is resolved from this file's folder, so the script works
// no matter which folder it is started from.
// ---------------------------------------------------------------------------
const WEB_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(WEB_DIR, '..');
const OUT_DIR = join(WEB_DIR, 'public');
const APP_DOCS_DIR = join(WEB_DIR, 'app-docs');

/**
 * The pages of the site: source Markdown -> output HTML file name.
 * The output names are short and stable because they are pasted into Play
 * Console and App Store Connect; changing one later means updating the stores.
 */
export const PAGES = [
  { src: 'web/content/index.md', out: 'index.html' },
  { src: 'docs/legal/PRIVACY_POLICY.md', out: 'privacy.html' },
  { src: 'docs/legal/TERMS_OF_USE.md', out: 'terms.html' },
  { src: 'docs/legal/ACCOUNT_DELETION_PAGE.md', out: 'delete-account.html' },
  { src: 'web/content/support.md', out: 'support.html' },
];

/**
 * §2.8 The legal texts the app shows in its Me screen, and their in-app file names.
 * Support and Home stay web-only.
 */
export const APP_DOCS = [
  { src: 'docs/legal/PRIVACY_POLICY.md', out: 'privacy.md' },
  { src: 'docs/legal/TERMS_OF_USE.md', out: 'terms.md' },
  { src: 'docs/legal/ACCOUNT_DELETION_PAGE.md', out: 'delete-account.md' },
];

/** Source Markdown name -> in-app Markdown name (§2.8). */
export const APP_LINK_MAP = Object.fromEntries(APP_DOCS.map((d) => [d.src.split('/').pop(), d.out]));

/** Markdown file name (as written in links) -> public HTML file name (§2.6). */
export const LINK_MAP = Object.fromEntries(
  PAGES.map((p) => [p.src.split('/').pop(), p.out]),
);

// ---------------------------------------------------------------------------
// §2.1 Internal blocks
// ---------------------------------------------------------------------------

/**
 * Removes every block between `<!-- internal -->` and `<!-- /internal -->`.
 * Fails on an opening marker without a closing one, so a half-written review
 * note can never leak onto the public site.
 */
export function stripInternal(text) {
  const open = '<!-- internal -->';
  const close = '<!-- /internal -->';
  let result = '';
  let rest = text;
  for (;;) {
    const start = rest.indexOf(open);
    if (start === -1) break;
    const end = rest.indexOf(close, start);
    if (end === -1) throw new Error('Unclosed <!-- internal --> block');
    result += rest.slice(0, start);
    rest = rest.slice(end + close.length);
  }
  if (rest.includes(close)) throw new Error('Stray <!-- /internal --> without an opening marker');
  return result + rest;
}

// ---------------------------------------------------------------------------
// §2.2 Conditional blocks
// ---------------------------------------------------------------------------

/**
 * Keeps or removes `<!-- if FLAG -->` / `<!-- if not FLAG -->` ... `<!-- endif -->`
 * blocks. Blocks may not be nested (keeps the documents easy to read).
 * An unknown flag name is an error, so a typo can't silently hide text.
 *
 * @param {string} text   the document
 * @param {Record<string, boolean>} flags  from site.config.json
 */
export function applyConditionals(text, flags) {
  const lines = text.split('\n');
  const out = [];
  let state = null; // null = outside a block; otherwise { keep: boolean }
  const ifRe = /^\s*<!-- if (not )?([A-Z_]+) -->\s*$/;
  const endRe = /^\s*<!-- endif -->\s*$/;

  for (const line of lines) {
    const m = line.match(ifRe);
    if (m) {
      if (state) throw new Error(`Nested <!-- if --> blocks are not allowed: "${line.trim()}"`);
      const name = m[2];
      if (!(name in flags)) throw new Error(`Unknown flag "${name}" (add it to site.config.json)`);
      const negate = Boolean(m[1]);
      state = { keep: negate ? !flags[name] : Boolean(flags[name]) };
      continue; // the marker line itself never appears in the output
    }
    if (endRe.test(line)) {
      if (!state) throw new Error('<!-- endif --> without a matching <!-- if -->');
      state = null;
      continue;
    }
    if (!state || state.keep) out.push(line);
  }
  if (state) throw new Error('Unclosed <!-- if --> block');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// §2.3 Review markers
// ---------------------------------------------------------------------------

/** Matches " [LAWYER L-12]" and " [VERIFY-AT-P7 V-3]" including the space before it. */
const REVIEW_MARKER_RE = /[ \t]?\[(?:LAWYER L|VERIFY-AT-P7 V)-\d+\]/g;

/** Removes review markers; they are for reviewers, not for app users. */
export function stripReviewMarkers(text) {
  return text.replace(REVIEW_MARKER_RE, '');
}

// ---------------------------------------------------------------------------
// §2.4 Placeholders
// ---------------------------------------------------------------------------

/**
 * Replaces {{NAME}} with the configured value.
 * - An EMPTY value leaves {{NAME}} visible (honest: the page shows what is
 *   still missing) and the name is reported as unfilled.
 * - An UNKNOWN name is an error (catches typos such as {{APPNAME}}).
 * - A filled CONTACT_EMAIL becomes a mailto link.
 *
 * @returns {{ text: string, unfilled: string[] }}
 */
export function fillPlaceholders(text, values) {
  const unfilled = new Set();
  const filled = text.replace(/\{\{([A-Z_]+)\}\}/g, (whole, name) => {
    if (!(name in values)) throw new Error(`Unknown placeholder {{${name}}}`);
    const value = String(values[name] ?? '').trim();
    if (value === '') {
      unfilled.add(name);
      return whole; // keep it visible
    }
    if (name === 'CONTACT_EMAIL') return `[${value}](mailto:${value})`;
    return value;
  });
  return { text: filled, unfilled: [...unfilled].sort() };
}

// ---------------------------------------------------------------------------
// §2.5 Markdown subset -> HTML
// ---------------------------------------------------------------------------

/** Escapes the five HTML special characters. Applied to ALL text first. */
export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Checks a link target and returns the final href (§2.6 rewrites .md links).
 * Throws on anything not on the allow-list (for example `javascript:`).
 */
export function safeHref(rawHref) {
  const href = rawHref.trim();
  if (/^https?:\/\//i.test(href)) return { href, external: true };
  if (/^mailto:[^\s]+$/i.test(href)) return { href, external: false };
  if (href.startsWith('#')) return { href, external: false };
  // Same-site document link, optionally with an #anchor.
  const m = href.match(/^([A-Za-z0-9_.-]+\.(?:md|html))(#[A-Za-z0-9_-]+)?$/);
  if (m) {
    const file = m[1].endsWith('.md') ? LINK_MAP[m[1]] : m[1];
    if (!file) throw new Error(`Link to a document that is not on the site: ${href}`);
    return { href: file + (m[2] ?? ''), external: false };
  }
  throw new Error(`Link not allowed on the public site: ${href}`);
}

/**
 * Inline formatting on ONE line of already-escaped text.
 * Order matters: code spans are protected first (no formatting inside them),
 * then links, then bold, then italic.
 */
export function renderInline(escaped) {
  const codes = [];
  let s = escaped.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // Links: [text](href). The href was escaped too, so un-escape &amp; for checking.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const { href: finalHref, external } = safeHref(href.replace(/&amp;/g, '&'));
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(finalHref)}"${attrs}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  return s;
}

/** Turns a heading's text into a stable id, so sections can be linked (#5-our-website-and-emails). */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Splits a table row "| a | b |" into trimmed cells. */
function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/**
 * Block-level Markdown subset: headings (# to ####), paragraphs (lines joined
 * with <br>), unordered (- ) and ordered (1. ) single-level lists, tables,
 * blockquotes (> ) and horizontal rules (---). Anything outside the subset is
 * rendered as plain text, never as raw HTML.
 *
 * @returns {{ html: string, title: string }}  title = text of the first H1
 */
export function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let title = '';
  let i = 0;

  const isBlank = (l) => l.trim() === '';
  const isHeading = (l) => /^#{1,4} /.test(l);
  const isUl = (l) => /^- /.test(l);
  const isOl = (l) => /^\d+\. /.test(l);
  const isTable = (l) => /^\|/.test(l.trim());
  const isQuote = (l) => /^> ?/.test(l);
  const isHr = (l) => /^---+\s*$/.test(l);
  const startsBlock = (l) => isHeading(l) || isUl(l) || isOl(l) || isTable(l) || isQuote(l) || isHr(l);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    if (isHeading(line)) {
      const level = line.match(/^#+/)[0].length;
      const inner = renderInline(escapeHtml(line.slice(level + 1).trim()));
      if (level === 1 && !title) title = inner.replace(/<[^>]+>/g, '');
      html.push(`<h${level} id="${slugify(inner)}">${inner}</h${level}>`);
      i++;
      continue;
    }

    if (isHr(line)) { html.push('<hr>'); i++; continue; }

    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const test = ordered ? isOl : isUl;
      const items = [];
      while (i < lines.length && test(lines[i])) {
        const text = lines[i].replace(ordered ? /^\d+\. / : /^- /, '');
        items.push(`<li>${renderInline(escapeHtml(text))}</li>`);
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    if (isTable(line)) {
      const rows = [];
      while (i < lines.length && isTable(lines[i])) rows.push(lines[i++]);
      if (rows.length < 2 || !/^\|?\s*:?-{3,}/.test(rows[1].trim())) {
        throw new Error(`Table without a header separator near: "${rows[0]}"`);
      }
      const head = splitRow(rows[0]).map((c) => `<th scope="col">${renderInline(escapeHtml(c))}</th>`);
      const body = rows.slice(2).map(
        (r) => `<tr>${splitRow(r).map((c) => `<td>${renderInline(escapeHtml(c))}</td>`).join('')}</tr>`,
      );
      html.push(`<div class="table-wrap"><table><thead><tr>${head.join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`);
      continue;
    }

    if (isQuote(line)) {
      const parts = [];
      while (i < lines.length && isQuote(lines[i])) parts.push(lines[i++].replace(/^> ?/, ''));
      html.push(`<blockquote><p>${parts.map((p) => renderInline(escapeHtml(p))).join('<br>')}</p></blockquote>`);
      continue;
    }

    // Paragraph: consecutive lines until a blank line or another block starts.
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !(para.length && startsBlock(lines[i]))) {
      para.push(lines[i++]);
    }
    html.push(`<p>${para.map((p) => renderInline(escapeHtml(p.trim()))).join('<br>')}</p>`);
  }
  return { html: html.join('\n'), title };
}

// ---------------------------------------------------------------------------
// §2.7 Page template
// ---------------------------------------------------------------------------

/**
 * Wraps a page body in the shared template.
 * The Content-Security-Policy allows only our own stylesheet: no scripts,
 * no frames, no forms, no external requests of any kind.
 */
export function renderPage({ title, body, appName, status, outFile }) {
  const nav = PAGES.map((p) => {
    const label = { 'index.html': 'Home', 'privacy.html': 'Privacy', 'terms.html': 'Terms', 'delete-account.html': 'Delete account', 'support.html': 'Support' }[p.out];
    const current = p.out === outFile ? ' aria-current="page"' : '';
    return `<a href="${p.out}"${current}>${label}</a>`;
  }).join('\n        ');
  const draftNotice = status === 'draft'
    ? '\n    <p class="notice" role="note">Draft: this page is still being reviewed and may change before the app is released.</p>'
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap">
      <a class="brand" href="index.html">${escapeHtml(appName)}</a>
      <nav aria-label="Site">
        ${nav}
      </nav>
    </div>
  </header>
  <main class="wrap">${draftNotice}
${body}
  </main>
  <footer class="site-footer">
    <div class="wrap">This site uses no cookies, no analytics and no scripts.</div>
  </footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Whole-page pipeline and site build
// ---------------------------------------------------------------------------

/**
 * Runs steps §2.1–§2.7 on one Markdown source.
 * @returns {{ html: string, unfilled: string[] }}
 */
export function buildPage(markdown, config, outFile) {
  let text = stripInternal(markdown);
  text = applyConditionals(text, config.flags);
  text = stripReviewMarkers(text);
  if (text.includes('<!--')) throw new Error(`Leftover HTML comment in the source of ${outFile}`);
  const { text: filled, unfilled } = fillPlaceholders(text, config.placeholders);
  const { html: body, title } = markdownToHtml(filled);
  const appName = String(config.placeholders.APP_NAME || '{{APP_NAME}}');
  const html = renderPage({ title: title || appName, body, appName, status: config.status, outFile });
  return { html, unfilled };
}

// ---------------------------------------------------------------------------
// §2.8 In-app Markdown copies
// ---------------------------------------------------------------------------

/**
 * Produces a self-contained Markdown copy of one legal text for the app:
 * the same steps §2.1–§2.4 as the web page (internal notes removed, flags
 * applied, review markers removed, placeholders filled), then links to the
 * other legal texts rewritten to their in-app names (privacy.md, terms.md,
 * delete-account.md). The result has no HTML comments, no build directives
 * and no links to files that aren't bundled, so the app can render it as is.
 * A draft notice is added at the top while status is "draft".
 *
 * @returns {{ markdown: string, unfilled: string[] }}
 */
export function buildAppMarkdown(markdown, config, outFile) {
  let text = stripInternal(markdown);
  text = applyConditionals(text, config.flags);
  text = stripReviewMarkers(text);
  if (text.includes('<!--')) throw new Error(`Leftover HTML comment in the source of ${outFile}`);
  const { text: filled, unfilled } = fillPlaceholders(text, config.placeholders);
  // Rewrite links between the legal texts; any other local .md link is an error,
  // because the app bundles only these three files.
  const linked = filled.replace(/\]\(([A-Za-z0-9_.-]+\.md)(#[A-Za-z0-9_-]+)?\)/g, (_, file, anchor = '') => {
    const target = APP_LINK_MAP[file];
    if (!target) throw new Error(`${outFile} links to ${file}, which isn't bundled in the app`);
    return `](${target}${anchor})`;
  });
  // Tidy: no runs of 3+ blank lines left behind by removed blocks; one final newline.
  const tidy = linked.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const notice = config.status === 'draft'
    ? '> **Draft:** this text is still being reviewed and may change before the app is released.\n\n'
    : '';
  return { markdown: notice + tidy, unfilled };
}

/** Reads and validates web/site.config.json. */
export function loadConfig(path = join(WEB_DIR, 'site.config.json')) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (!['draft', 'final'].includes(config.status)) throw new Error('status must be "draft" or "final"');
  if (typeof config.placeholders !== 'object' || typeof config.flags !== 'object') {
    throw new Error('site.config.json needs "placeholders" and "flags" objects');
  }
  return config;
}

/**
 * Builds every page in memory and checks that every same-site link points to
 * a page that exists. Returns the files to write.
 */
export function buildSite(config, readSource = (p) => readFileSync(join(REPO_ROOT, p), 'utf8')) {
  const files = new Map();
  const unfilled = new Set();
  for (const page of PAGES) {
    const { html, unfilled: missing } = buildPage(readSource(page.src), config, page.out);
    missing.forEach((m) => unfilled.add(m));
    files.set(page.out, html);
  }
  // The stylesheet and .nojekyll (tells GitHub Pages to serve files as they are).
  files.set('style.css', readFileSync(join(WEB_DIR, 'style.css'), 'utf8'));
  files.set('.nojekyll', '');
  // Internal link check: every href="x.html" must be one of our pages.
  for (const [name, html] of files) {
    for (const [, target] of html.matchAll(/href="([A-Za-z0-9_.-]+\.(?:html|css))(?:#[^"]*)?"/g)) {
      if (!files.has(target)) throw new Error(`${name} links to missing page ${target}`);
    }
  }
  // §2.8 in-app Markdown copies.
  const appFiles = new Map();
  for (const doc of APP_DOCS) {
    const { markdown, unfilled: missing } = buildAppMarkdown(readSource(doc.src), config, doc.out);
    missing.forEach((m) => unfilled.add(m));
    appFiles.set(doc.out, markdown);
  }
  return { files, appFiles, unfilled: [...unfilled].sort() };
}

/** Lists files in `dir` that are stale or missing compared with `files`, plus extra files. */
function compareDir(dir, files) {
  const stale = [];
  for (const [name, content] of files) {
    const path = join(dir, name);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) stale.push(name);
  }
  const extra = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && !files.has(d.name)).map((d) => d.name)
    : [];
  return { stale, extra };
}

function main(argv) {
  const check = argv.includes('--check');
  const release = argv.includes('--release');
  const config = loadConfig();
  const { files, appFiles, unfilled } = buildSite(config);

  if (release) {
    const problems = [];
    if (config.status !== 'final') problems.push('status is "draft" (set it to "final" after the legal review and P7 check)');
    if (unfilled.length) problems.push(`empty placeholders: ${unfilled.join(', ')}`);
    if (problems.length) {
      console.error(`Release build refused:\n - ${problems.join('\n - ')}`);
      process.exit(1);
    }
  }

  if (check) {
    // Compare with what is committed in web/public/ and web/app-docs/.
    const pub = compareDir(OUT_DIR, files);
    const app = compareDir(APP_DOCS_DIR, appFiles);
    const problems = [
      ...pub.stale.map((n) => `public/${n} stale`), ...pub.extra.map((n) => `public/${n} extra`),
      ...app.stale.map((n) => `app-docs/${n} stale`), ...app.extra.map((n) => `app-docs/${n} extra`),
    ];
    if (problems.length) {
      console.error(`Generated files are out of date: ${problems.join(', ')}.\nRun: node web/build-site.mjs`);
      process.exit(1);
    }
    console.log(`web/public (${files.size} files) and web/app-docs (${appFiles.size} files) are up to date. Unfilled placeholders: ${unfilled.join(', ') || 'none'}.`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, content] of files) writeFileSync(join(OUT_DIR, name), content);
  mkdirSync(APP_DOCS_DIR, { recursive: true });
  for (const [name, content] of appFiles) writeFileSync(join(APP_DOCS_DIR, name), content);
  console.log(`Built ${files.size} files into web/public and ${appFiles.size} into web/app-docs. Status: ${config.status}. Unfilled placeholders: ${unfilled.join(', ') || 'none'}.`);
}

// Run main() only when started directly (not when imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`build-site failed: ${err.message}`);
    process.exit(1);
  }
}
