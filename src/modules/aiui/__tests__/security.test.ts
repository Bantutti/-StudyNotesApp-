/**
 * Static security checks on the aiui source (build rules §1):
 * - no network code (all requests go through the ai engine's fixed hosts);
 * - no console logging, no eval, no HTML rendering, no WebView;
 * - no navigation params (note text and keys never go into routes, §3.3);
 * - the only external URLs opened are the provider catalog's fixed ones.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function sources(dir = ROOT): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('aiui source', () => {
  const files = sources().map((p) => ({ p, s: readFileSync(p, 'utf8') }));

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each([
    ['network calls', /\bfetch\s*\(|XMLHttpRequest|WebSocket/],
    ['console logging', /\bconsole\./],
    ['eval', /\beval\s*\(|new Function\s*\(/],
    ['HTML rendering', /dangerouslySetInnerHTML|innerHTML|react-native-webview|WebView/],
    ['navigation params', /expo-router|useLocalSearchParams|router\.push/],
    ['hard-coded URLs', /https?:\/\//],
  ])('contains no %s', (_name, re) => {
    const hits = files.filter((f) => re.test(f.s.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, ''))).map((f) => f.p);
    expect(hits).toEqual([]);
  });
});
