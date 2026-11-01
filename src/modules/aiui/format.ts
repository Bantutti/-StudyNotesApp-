/**
 * Text for usage lines and progress (ALGORITHMS §4). Pure; tested.
 */
import { describeWait, PROVIDER_CATALOG, type Provider, type RunProgress } from '@/modules/ai';

import type { UsageLine } from './flow/types';
import { ta } from './strings';

const n = (x: number) => x.toLocaleString('en-US');

/** §4.1 "Groq · 12 of 1,000 requests today" or "Mistral · 3 requests today". */
export function usageText(u: UsageLine): string {
  const label = PROVIDER_CATALOG[u.provider].label;
  const base =
    u.dailyLimit !== null
      ? ta('ai.usage.ofLimit', { provider: label, count: n(u.requests), limit: n(u.dailyLimit) })
      : ta('ai.usage.noLimit', { provider: label, count: n(u.requests) });
  return u.remaining !== null ? `${base} ${ta('ai.usage.remaining', { left: n(u.remaining) })}` : base;
}

/** §4.2 Whole seconds for short waits, "about N minutes" otherwise. */
export function waitText(ms: number): string {
  if (ms < 60_000) return ta('ai.wait.seconds', { s: Math.max(1, Math.ceil(ms / 1000)) });
  return describeWait(ms);
}

/** What the Running screen says for each engine progress event. */
export function progressText(p: RunProgress | null, provider: Provider): string {
  const label = PROVIDER_CATALOG[provider].label;
  if (!p) return ta('ai.run.starting', { provider: label });
  switch (p.phase) {
    case 'sending':
      return p.parts > 1 ? ta('ai.run.sendingPart', { provider: label, part: p.part + 1, parts: p.parts }) : ta('ai.run.sending', { provider: label });
    case 'waiting':
      return p.reason === 'pacing'
        ? ta('ai.run.pacing', { wait: waitText(p.waitMs) })
        : ta('ai.run.retrying', { provider: label, wait: waitText(p.waitMs) });
    case 'reasking':
      return ta('ai.run.reasking', { provider: label });
    case 'fallback':
      return ta('ai.run.fallback', { provider: label });
  }
}

/** "1 Nov 2026" style date for settings (local calendar, no time). */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
