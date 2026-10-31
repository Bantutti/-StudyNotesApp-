import { decode, encode, toNativeSchema } from '../protocol';
import { allowNavigation } from '../webviewPolicy';
import { createLinkOpener, linkHost, type LinkPorts } from '../links';

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
