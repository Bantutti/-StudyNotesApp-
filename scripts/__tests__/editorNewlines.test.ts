/**
 * The generated WebView page must be identical on Windows and Linux.
 * The script hash covers only the editor JS; this test compares the HTML
 * template separately so CRLF conversion cannot hide stale CSS or markup.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EDITOR_CSP, EDITOR_HTML } from '../../src/modules/editor/generated/editorHtml';

describe('editor template generation', () => {
  it('stores a canonical LF template without changing its markup or styles', () => {
    // The source checkout may use either line ending on the developer's OS.
    const source = readFileSync(join(__dirname, '../../editor-web/src/template.html'), 'utf8').replace(/\r\n?/g, '\n');

    // Remove only the dynamic CSP and JS. Comparing the remainder still
    // catches missing styles, tags, placeholder changes and extra characters.
    const withoutCsp = EDITOR_HTML.replace(EDITOR_CSP, '__CSP__');
    const scriptStart = withoutCsp.indexOf('<script>');
    const scriptEnd = withoutCsp.lastIndexOf('</script>');
    expect(scriptStart).toBeGreaterThanOrEqual(0);
    expect(scriptEnd).toBeGreaterThan(scriptStart);
    const template = `${withoutCsp.slice(0, scriptStart)}<script>__SCRIPT__${withoutCsp.slice(scriptEnd)}`;
    expect(template).toBe(source);
  });
});
