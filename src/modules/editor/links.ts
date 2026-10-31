/**
 * Opening links from notes.
 *
 * Apple age-rating rule (C1 compliance, Nov 1 2026): browsing inside the app
 * counts as "unrestricted web access" and can raise the rating to 16+. So a
 * link in a note NEVER loads inside the app's WebView:
 *  - the editor page blocks navigation (CSP + onShouldStartLoadWithRequest
 *    allows only the local document, see webviewPolicy.ts),
 *  - a link tap is sent to the native side as an `openLink` bridge message,
 *  - the native side re-validates the URL, shows where it leads, and on
 *    confirmation hands it to the OPERATING SYSTEM (Linking.openURL), which
 *    opens the user's normal browser or mail app outside the app.
 * Pure logic here; the Expo adapter is expoLinkPorts.
 */
import { safeHref } from '@/core';

export interface LinkPorts {
  /** Hands the URL to the OS (Linking.openURL). */
  openExternal(url: string): Promise<void>;
  /** Asks the user; resolves true to open. `shown` is what the dialog displays. */
  confirm(shown: { host: string; url: string }): Promise<boolean>;
}

export type LinkOpenResult = 'opened' | 'cancelled' | 'rejected' | 'busy' | 'failed';

/** Display host for the confirm dialog (lowercased, IDN shown as punycode by URL). */
export function linkHost(url: string): string {
  if (/^mailto:/i.test(url)) return url.slice(7, 120);
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  const authority = m?.[1] ?? '';
  // Drop any "user:pass@" part: it is a classic way to disguise the real host.
  return authority.replace(/^.*@/, '').toLowerCase().slice(0, 120);
}

export function createLinkOpener(ports: LinkPorts) {
  let busy = false;
  return async function openLink(raw: unknown): Promise<LinkOpenResult> {
    if (typeof raw !== 'string') return 'rejected';
    const url = safeHref(raw);
    // Whitespace or control characters inside a URL are a spoofing trick, never valid.
    if (!url || /[\u0000-\u0020\u007F-\u009F\u2028\u2029]/.test(url)) return 'rejected';
    if (busy) return 'busy'; // one dialog at a time; repeated taps are ignored
    busy = true;
    try {
      const ok = await ports.confirm({ host: linkHost(url), url });
      if (!ok) return 'cancelled';
      await ports.openExternal(url);
      return 'opened';
    } catch {
      return 'failed';
    } finally {
      busy = false;
    }
  };
}

export type LinkOpener = ReturnType<typeof createLinkOpener>;
