/**
 * Native sign-in token sources (ports). P2b ships "unavailable" stubs:
 * Google needs a real Firebase project + OAuth client and a development
 * build; Apple also needs a paid Apple Developer account (Q1, Rey's later
 * decision). The Firebase half (credential -> sign-in -> verified -> sync)
 * is built and tested on the emulator with its fake ID tokens.
 */
import type { AppleScope, GoogleScope } from './scopes';

export interface GoogleTokenRequest {
  scopes: readonly GoogleScope[];
}
export interface GoogleTokenSource {
  readonly available: boolean;
  /** Returns a Google ID token, or null when the person cancelled. */
  getIdToken(req: GoogleTokenRequest): Promise<string | null>;
}

export interface AppleTokenRequest {
  scopes: readonly AppleScope[];
  /** SHA-256 of the raw nonce (hex), sent to Apple; Firebase checks the raw one. */
  hashedNonce: string;
}
export interface AppleTokenResult {
  identityToken: string;
  /** One-time code; needed to revoke the Apple tokens on account deletion. */
  authorizationCode: string | null;
}
export interface AppleTokenSource {
  readonly available: boolean;
  signIn(req: AppleTokenRequest): Promise<AppleTokenResult | null>;
}

export interface CryptoPort {
  randomHex(bytes: number): string;
  sha256Hex(text: string): Promise<string>;
}

export const unavailableGoogle: GoogleTokenSource = {
  available: false,
  async getIdToken() {
    return null;
  },
};

export const unavailableApple: AppleTokenSource = {
  available: false,
  async signIn() {
    return null;
  },
};
