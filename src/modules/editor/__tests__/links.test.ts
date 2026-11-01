import { domainToASCII } from 'node:url';

import { decode, encode, toNativeSchema } from '../protocol';
import { allowNavigation } from '../webviewPolicy';
import { createLinkOpener, linkHost, type LinkPorts } from '../links';
import { punycodeEncode, toAsciiHost } from '../punycode';

function ports(answer = true) {
  const opened: string[] = [];
  const asked: { host: string; url: string }[] = [];
  const p: LinkPorts = {
    openExternal: async (url) => {
      opened.push(url);
    },
    confirm: async (shown) => {
      asked.push(shown);
      return answer;
    },
  };
  return { p, opened, asked };
}

describe('links open outside the app (Apple age-rating rule)', () => {
  it('the editor WebView itself never navigates to a link', () => {
    for (const url of ['https://example.com', 'http://example.com', 'mailto:a@b.co']) expect(allowNavigation(url)).toBe(false);
  });

  it('carries link taps over the bridge as openLink messages', () => {
    const r = decode(encode({ v: 1, type: 'openLink', href: 'https://example.com/a' }), toNativeSchema);
    expect(r.ok).toBe(true);
    expect(decode(JSON.stringify({ v: 1, type: 'openLink', href: 'x'.repeat(2001) }), toNativeSchema).ok).toBe(false);
  });

  it('asks first, showing the real host, then hands the URL to the OS', async () => {
    const { p, opened, asked } = ports(true);
    expect(await createLinkOpener(p)('https://user:pw@evil.example/path?q=1')).toBe('opened');
    expect(asked[0]?.host).toBe('evil.example');
    expect(opened).toEqual(['https://user:pw@evil.example/path?q=1']);
  });

  it('does nothing when the user cancels', async () => {
    const { p, opened } = ports(false);
    expect(await createLinkOpener(p)('https://example.com')).toBe('cancelled');
    expect(opened).toEqual([]);
  });

  it('rejects unsafe or malformed URLs without asking', async () => {
    const { p, opened, asked } = ports(true);
    const open = createLinkOpener(p);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/hosts', 'intent://x#Intent;end', 'https://exa mple.com', 'https://a.com/\u0000x', 42, null]) {
      expect(await open(bad)).toBe('rejected');
    }
    expect(asked).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('ignores repeated taps while a dialog is open', async () => {
    let release: (v: boolean) => void = () => undefined;
    const opened: string[] = [];
    const open = createLinkOpener({
      openExternal: async (u) => {
        opened.push(u);
      },
      confirm: () => new Promise((res) => (release = res)),
    });
    const first = open('https://example.com');
    expect(await open('https://example.com')).toBe('busy');
    release(true);
    expect(await first).toBe('opened');
    expect(opened).toHaveLength(1);
  });

  it('reports a failure from the OS instead of throwing', async () => {
    const open = createLinkOpener({ openExternal: async () => Promise.reject(new Error('no browser')), confirm: async () => true });
    expect(await open('mailto:prof@school.edu')).toBe('failed');
  });

  it('shows a readable host', () => {
    expect(linkHost('HTTPS://Docs.Example.COM:8443/x')).toBe('docs.example.com:8443');
    expect(linkHost('mailto:prof@school.edu')).toBe('prof@school.edu');
  });
});

describe('link spoofing (review L1)', () => {
  it('rejects backslashes: "https://evil.example\\@good.example/" would open evil.example', async () => {
    const { p, opened, asked } = ports(true);
    const open = createLinkOpener(p);
    expect(await open('https://evil.example\\@good.example/')).toBe('rejected');
    expect(await open('https://good.example\\evil')).toBe('rejected');
    expect(asked).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('shows internationalized hosts as punycode, the way browsers resolve them', async () => {
    const { p, asked } = ports(false);
    await createLinkOpener(p)('https://bücher.example/a');
    expect(asked[0]?.host).toBe('xn--bcher-kva.example');
    // Cyrillic "а" (U+0430) in a look-alike of apple.com
    expect(linkHost('https://\u0430pple.com/')).toBe('xn--pple-43d.com');
    expect(linkHost('https://xn--pple-43d.com/')).toBe('xn--pple-43d.com');
    // Unicode full stops separate labels too
    expect(linkHost('https://good\u3002example/')).toBe('good.example');
    expect(linkHost('https://User:pw@Example.COM:8443/x')).toBe('example.com:8443');
  });

  it('punycode matches RFC 3492 sample strings', () => {
    expect(punycodeEncode('bücher')).toBe('bcher-kva');
    expect(punycodeEncode('münchen')).toBe('mnchen-3ya');
    expect(punycodeEncode('пример')).toBe('e1afmkfd');
    expect(punycodeEncode('☃')).toBe('n3h');
    expect(punycodeEncode('例え')).toBe('r8jz45g');
    // RFC 3492 7.1 (B) Chinese (simplified)
    expect(punycodeEncode('\u4ED6\u4EEC\u4E3A\u4EC0\u4E48\u4E0D\u8BF4\u4E2D\u6587')).toBe('ihqwcrb4cv8a8dqg056pqjye');
    expect(toAsciiHost('Ünïcode.Example')).toBe('xn--ncode-cta3g.example');
  });

  it('agrees with Node\'s WHATWG host parser on mixed scripts', () => {
    const hosts = ['bücher.de', 'παράδειγμα.δοκιμή', '例え.テスト', 'مثال.إختبار', 'ex\u0430mple.com', 'café.fr', 'straße.example', 'ﬁle.example', 'ⓐbc.example', 'BÜCHER.DE', 'ｅｘａｍｐｌｅ.com'];
    for (const h of hosts) {
      const node = domainToASCII(h);
      expect(node).not.toBe('');
      expect(toAsciiHost(h)).toBe(node);
    }
  });
});
