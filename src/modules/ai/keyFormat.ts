/**
 * Bring-your-own-key handling: provider list, format checks, masking.
 * Keys are user secrets: never logged, never sent to our backend.
 *
 * P3a: Mistral added (Rey, Nov 1, Q2 = A). The Groq slot and pattern are
 * unchanged from P0 so one Groq key serves Whisper (voice) and chat (ai).
 */
import { AppError, fail, ok, type Result } from '@/core';

export const PROVIDERS = ['groq', 'mistral'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_INFO: Record<Provider, { label: string; keyUrl: string; pattern: RegExp }> = {
  groq: {
    label: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    pattern: /^gsk_[A-Za-z0-9]{20,100}$/,
  },
  mistral: {
    label: 'Mistral',
    // Mistral console home (the docs page "Activate Studio and generate an API key"
    // links here and walks to the API keys screen). Confirmed during the live check.
    keyUrl: 'https://console.mistral.ai/',
    // Mistral documents no key prefix or length. This is a loose shape check
    // (letters and digits only, 20-128 chars) that catches obvious paste
    // mistakes such as a Groq key or a URL; the Test key call is the real check.
    pattern: /^[A-Za-z0-9]{20,128}$/,
  },
};

/** Narrows an unknown value (e.g. from a screen) to a known provider id. */
export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

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
