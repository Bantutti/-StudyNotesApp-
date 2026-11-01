/**
 * Unit tests for web/build-site.mjs (Node's built-in test runner, no npm needed).
 * Run from the repo root:   node --test web/test/build-site.test.mjs
 * Each test names the build step it covers (§2.x in web/README.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripInternal, applyConditionals, stripReviewMarkers, fillPlaceholders,
  escapeHtml, safeHref, renderInline, markdownToHtml, buildPage, buildSite, loadConfig, PAGES,
} from '../build-site.mjs';

const baseConfig = {
  status: 'draft',
  placeholders: { APP_NAME: 'NotedPo', DEVELOPER_LEGAL_NAME: '', CONTACT_EMAIL: '', EFFECTIVE_DATE: '', SITE_BASE_URL: '' },
  flags: { FILE_SYNC: false, VISION_AI: false, APP_CHECK: false },
};

// §2.1 -----------------------------------------------------------------------
test('§2.1 internal blocks are removed', () => {
  const out = stripInternal('a\n<!-- internal -->\nsecret\n<!-- /internal -->\nb');
  assert.equal(out.includes('secret'), false);
  assert.match(out, /a\n\nb/);
});

test('§2.1 an unclosed internal block fails instead of leaking', () => {
  assert.throws(() => stripInternal('<!-- internal -->\nsecret'), /Unclosed/);
  assert.throws(() => stripInternal('x <!-- /internal -->'), /Stray/);
});

// §2.2 -----------------------------------------------------------------------
test('§2.2 if / if not blocks follow the flags', () => {
  const src = 'top\n<!-- if FILE_SYNC -->\nsynced\n<!-- endif -->\n<!-- if not FILE_SYNC -->\nlocal\n<!-- endif -->\nend';
  const off = applyConditionals(src, { FILE_SYNC: false });
  assert.equal(off, 'top\nlocal\nend');
  const on = applyConditionals(src, { FILE_SYNC: true });
  assert.equal(on, 'top\nsynced\nend');
});

test('§2.2 unknown flags, nesting and unbalanced markers fail', () => {
  assert.throws(() => applyConditionals('<!-- if NOPE -->\nx\n<!-- endif -->', {}), /Unknown flag/);
  assert.throws(() => applyConditionals('<!-- if A -->\n<!-- if A -->\n<!-- endif -->\n<!-- endif -->', { A: true }), /Nested/);
  assert.throws(() => applyConditionals('<!-- endif -->', {}), /without a matching/);
  assert.throws(() => applyConditionals('<!-- if A -->\nx', { A: true }), /Unclosed/);
});

// §2.3 -----------------------------------------------------------------------
test('§2.3 review markers are removed with their leading space', () => {
  assert.equal(stripReviewMarkers('Rule here. [LAWYER L-12] Next [VERIFY-AT-P7 V-3]'), 'Rule here. Next');
  assert.equal(stripReviewMarkers('[LAWYER L-1]'), '');
});

// §2.4 -----------------------------------------------------------------------
test('§2.4 empty placeholders stay visible and are reported', () => {
  const { text, unfilled } = fillPlaceholders('{{APP_NAME}} by {{DEVELOPER_LEGAL_NAME}}', baseConfig.placeholders);
  assert.equal(text, 'NotedPo by {{DEVELOPER_LEGAL_NAME}}');
  assert.deepEqual(unfilled, ['DEVELOPER_LEGAL_NAME']);
});

test('§2.4 unknown placeholders fail; CONTACT_EMAIL becomes a mailto link', () => {
  assert.throws(() => fillPlaceholders('{{APPNAME}}', baseConfig.placeholders), /Unknown placeholder/);
  const { text } = fillPlaceholders('{{CONTACT_EMAIL}}', { CONTACT_EMAIL: 'a.b@gmail.com' });
  assert.equal(text, '[a.b@gmail.com](mailto:a.b@gmail.com)');
});

// §2.5 -----------------------------------------------------------------------
test('§2.5 HTML in the text is escaped, never rendered', () => {
  const { html } = markdownToHtml('Hello <script>alert(1)</script> & "x"');
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(escapeHtml(`<'">&`), '&lt;&#39;&quot;&gt;&amp;');
});

test('§2.5 headings, lists, tables, quotes and paragraphs', () => {
  const md = '# Title\n\nPara line one\nline two\n\n- a\n- **b**\n\n1. one\n2. two\n\n| H1 | H2 |\n|---|---|\n| c | d |\n\n> quoted';
  const { html, title } = markdownToHtml(md);
  assert.equal(title, 'Title');
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<p>Para line one<br>line two<\/p>/);
  assert.match(html, /<ul><li>a<\/li><li><strong>b<\/strong><\/li><\/ul>/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<th scope="col">H1<\/th>/);
  assert.match(html, /<td>d<\/td>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
});

test('§2.5 a table without a separator row fails', () => {
  assert.throws(() => markdownToHtml('| a | b |\n| c | d |'), /header separator/);
});

test('§2.5 inline code is not formatted inside', () => {
  assert.equal(renderInline('`**x**` and *y*'), '<code>**x**</code> and <em>y</em>');
});

// §2.6 -----------------------------------------------------------------------
test('§2.6 document links are rewritten; unsafe links fail', () => {
  assert.equal(safeHref('PRIVACY_POLICY.md').href, 'privacy.html');
  assert.equal(safeHref('TERMS_OF_USE.md#3-ai-features').href, 'terms.html#3-ai-features');
  assert.equal(safeHref('https://privacy.gov.ph').external, true);
  assert.throws(() => safeHref('javascript:alert(1)'), /not allowed/);
  assert.throws(() => safeHref('DATA_INVENTORY.md'), /not on the site/);
  const out = renderInline('[NPC](https://privacy.gov.ph)');
  assert.match(out, /target="_blank" rel="noopener noreferrer"/);
});

// §2.7 and whole pipeline -------------------------------------------------------
test('§2.7 pages have a strict CSP, no scripts, and a draft notice in draft mode', () => {
  const { html } = buildPage('# T\n\nBody [LAWYER L-1]', baseConfig, 'privacy.html');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'self'/);
  assert.equal(/<script/i.test(html), false);
  assert.match(html, /class="notice"/);
  assert.equal(html.includes('LAWYER'), false);
  const final = buildPage('# T', { ...baseConfig, status: 'final' }, 'privacy.html').html;
  assert.equal(final.includes('class="notice"'), false);
});

test('the real documents build, with no review notes or comments leaking', () => {
  const config = loadConfig();
  const { files, unfilled } = buildSite(config);
  assert.equal(files.size, PAGES.length + 2); // pages + style.css + .nojekyll
  for (const [name, html] of files) {
    if (!name.endsWith('.html')) continue;
    assert.equal(/LAWYER|VERIFY-AT-P7|<!--|DRAFT for review/.test(html), false, `${name} leaks review text`);
    assert.equal(/<script/i.test(html), false, `${name} contains a script`);
  }
  // Until Rey fills them, these must be reported as missing.
  for (const name of ['DEVELOPER_LEGAL_NAME', 'CONTACT_EMAIL']) {
    if (!config.placeholders[name]) assert.ok(unfilled.includes(name));
  }
});

test('FILE_SYNC switches the privacy policy text', () => {
  const config = loadConfig();
  const off = buildSite({ ...config, flags: { ...config.flags, FILE_SYNC: false } }).files.get('privacy.html');
  const on = buildSite({ ...config, flags: { ...config.flags, FILE_SYNC: true } }).files.get('privacy.html');
  assert.match(off, /Files stay on your phone/);
  assert.match(on, /Cloud Storage for Firebase stores copies/);
  assert.equal(on.includes('Files stay on your phone'), false);
});
