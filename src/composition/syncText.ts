/** Wording helpers for the sync screens (no content, ids only). */
import type { UploadCounts } from './syncController';

const LABELS: Record<string, [string, string]> = {
  notes: ['note', 'notes'], subjects: ['subject', 'subjects'], folders: ['folder', 'folders'], cards: ['card', 'cards'],
  reviewLogs: ['review', 'reviews'], recordings: ['recording', 'recordings'], assets: ['file', 'files'],
  stylePacks: ['custom look', 'custom looks'], templates: ['template', 'templates'],
};

export function countsText(c: UploadCounts): string {
  const parts = Object.entries(c)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${n} ${(LABELS[k] ?? [k, k])[n === 1 ? 0 : 1]}`);
  return parts.length ? parts.join(', ') : 'nothing yet';
}

/** "r•••@gmail.com": enough to recognise the account on a shared screen. */
export function maskEmail(e: string | null): string {
  if (!e) return 'your account';
  const [user = '', domain = ''] = e.split('@');
  return `${user.slice(0, 1)}•••@${domain}`;
}

