/**
 * Bring-your-own-key handling: provider list, format checks, masking.
 * Keys are user secrets: never logged, never sent to our backend.
 */
import { AppError, fail, ok, type Result } from '@/core';

export const PROVIDERS = ['groq'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_INFO: Record<Provider, { label: string; keyUrl: string; pattern: RegExp }> = {
  groq: {
    label: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    pattern: /^gsk_[A-Za-z0-9]{20,100}$/,
  },
};

/** Trims whitespace (common when pasting) and checks the provider's key shape. */
export function normalizeKey(provider: Provider, raw: string): Result<string> {
  const key = raw.trim();
  if (!PROVIDER_INFO[provider].pattern.test(key)) {
    return fail(new AppError('invalid_key', `That does not look like a ${PROVIDER_INFO[provider].label} key.`));
  }
  return ok(key);
}

/** "gsk_…Ab3x": enough to recognise the key, useless to an attacker. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
