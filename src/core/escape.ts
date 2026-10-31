/** HTML escaping for every string we place into generated HTML. */
const MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => MAP[ch] as string);
}

/** Only http(s) and mailto links survive; anything else becomes null. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.length > 2000) return null;
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null;
}
