/**
 * What we ask Google and Apple for: an email address and nothing else
 * (C1's store forms depend on this; decision from the Lead, Nov 1 2026).
 *
 * - Google: `openid email`. Never `profile` (name and photo).
 * - Apple: email only. Never the full-name scope.
 *
 * These are the ONLY places the scopes are written. The native sign-in
 * modules (added when there is a real Firebase project and a development
 * build) must take their scopes from here; scopes.test.ts pins them.
 */
export const GOOGLE_SCOPES = Object.freeze(['openid', 'email'] as const);
export const APPLE_SCOPES = Object.freeze(['email'] as const);

export type GoogleScope = (typeof GOOGLE_SCOPES)[number];
export type AppleScope = (typeof APPLE_SCOPES)[number];

/** Scopes that would make us collect a name or photo; refused if a token source ever asks. */
export const FORBIDDEN_SCOPES: readonly string[] = ['profile', 'name', 'fullName', 'full_name', 'FULL_NAME'];
