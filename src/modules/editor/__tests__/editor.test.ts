import { createHash } from 'node:crypto';

import { EDITOR_CSP, EDITOR_HTML, EDITOR_SCRIPT_SHA256 } from '../generated/editorHtml';
import { decode, encode, MAX_BRIDGE_CHARS, toNativeSchema, toWebSchema } from '../protocol';
import { allowNavigation, HARDENED_WEBVIEW_PROPS } from '../webviewPolicy';

describe('bridge protocol', () => {
  it('accepts valid messages both ways', () => {
    expect(decode(encode({ v: 1, type: 'ping', reqId: 1, sentAt: 5 }), toWebSchema).ok).toBe(true);
    expect(decode(encode({ v: 1, type: 'metric', name: 'boot_ms', ms: 12 }), toNativeSchema).ok).toBe(true);
  });
  it('rejects oversize, non-JSON, unknown and wrong-version messages', () => {
    expect(decode('x'.repeat(MAX_BRIDGE_CHARS + 1), toWebSchema)).toEqual({ ok: false, reason: 'too_large' });
    expect(decode('{nope', toWebSchema)).toEqual({ ok: false, reason: 'not_json' });
    expect(decode(JSON.stringify({ v: 1, type: 'eval', code: 'x' }), toWebSchema)).toEqual({ ok: false, reason: 'invalid' });
    expect(decode(JSON.stringify({ v: 2, type: 'ready' }), toNativeSchema)).toEqual({ ok: false, reason: 'invalid' });
    expect(decode(JSON.stringify({ v: 1, type: 'command', name: 'insertHTML' }), toWebSchema).ok).toBe(false);
    expect(decode({ not: 'a string' }, toWebSchema).ok).toBe(false);
  });
});

describe('WebView policy', () => {
  it('blocks every navigation except the local document', () => {
    expect(allowNavigation('about:blank')).toBe(true);
    for (const url of ['https://evil.example', 'file:///data/data/app/x', 'javascript:alert(1)', 'intent://x', 'data:text/html,x']) {
      expect(allowNavigation(url)).toBe(false);
    }
  });
  it('disables file access, new windows, storage and mixed content', () => {
    expect(HARDENED_WEBVIEW_PROPS).toMatchObject({
      allowFileAccess: false,
      allowFileAccessFromFileURLs: false,
      allowUniversalAccessFromFileURLs: false,
      setSupportMultipleWindows: false,
      javaScriptCanOpenWindowsAutomatically: false,
      domStorageEnabled: false,
      incognito: true,
      mixedContentMode: 'never',
      geolocationEnabled: false,
    });
  });
});

describe('generated editor page', () => {
  const script = EDITOR_HTML.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? '';
  it('pins exactly the inline script with a SHA-256 CSP hash', () => {
    expect(script.length).toBeGreaterThan(1000);
    const hash = createHash('sha256').update(script, 'utf8').digest('base64');
    expect(hash).toBe(EDITOR_SCRIPT_SHA256);
    expect(EDITOR_CSP).toContain(`script-src 'sha256-${hash}'`);
    expect(EDITOR_HTML).toContain(EDITOR_CSP);
    expect((EDITOR_HTML.match(/<script/g) ?? []).length).toBe(1);
  });
  it('allows no network, eval, frames or remote resources', () => {
    expect(EDITOR_CSP).toContain("default-src 'none'");
    expect(EDITOR_CSP).toContain("connect-src 'none'");
    expect(EDITOR_CSP).not.toMatch(/unsafe-eval|https?:|\*/);
    expect(EDITOR_HTML).not.toMatch(/<(link|iframe|img)\b/i);
  });
});
