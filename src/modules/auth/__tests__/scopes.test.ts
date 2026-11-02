/**
 * C1's store forms declare only "Email address" for sign-in, so Google must
 * request `openid email` (never `profile`) and Apple email only (never the
 * full name). These tests pin what the auth service actually asks for.
 */
import { createLogger, memorySink } from '@/core';

import { createAuthService } from '../authService';
import type { AppleTokenRequest, GoogleTokenRequest } from '../ports';
import { APPLE_SCOPES, GOOGLE_SCOPES } from '../scopes';

const mockCalls: { appleCred?: unknown } = {};

jest.mock('firebase/auth', () => {
  const user = { uid: 'u1', email: 'a@b.co', emailVerified: true, displayName: null, photoURL: null, providerData: [], getIdToken: jest.fn(), reload: jest.fn() };
  return {
    onIdTokenChanged: jest.fn(),
    signInWithCredential: jest.fn(async () => ({ user })),
    reauthenticateWithCredential: jest.fn(async () => ({ user })),
    updateProfile: jest.fn(),
    GoogleAuthProvider: { credential: jest.fn((idToken: string) => ({ providerId: 'google.com', idToken })) },
    OAuthProvider: jest.fn().mockImplementation((id: string) => ({
      credential: (o: unknown) => {
        mockCalls.appleCred = o;
        return { providerId: id, ...(o as object) };
      },
    })),
    EmailAuthProvider: { credential: jest.fn() },
  };
});


const logger = createLogger({ sink: memorySink(), minLevel: 'debug' });
const auth = { currentUser: { uid: 'u1', email: 'a@b.co', emailVerified: true, providerData: [] } } as never;

function service() {
  const google = { available: true, getIdToken: jest.fn(async (_r: GoogleTokenRequest) => 'google-id-token') };
  const apple = { available: true, signIn: jest.fn(async (_r: AppleTokenRequest) => ({ identityToken: 'apple-id-token', authorizationCode: 'code-1' })) };
  const crypto = { randomHex: () => 'ab'.repeat(32), sha256Hex: async (t: string) => `sha256(${t})` };
  return { svc: createAuthService({ auth, google, apple, crypto, logger }), google, apple };
}

describe('requested scopes', () => {
  it('are exactly openid + email for Google and email for Apple', () => {
    expect([...GOOGLE_SCOPES]).toEqual(['openid', 'email']);
    expect([...APPLE_SCOPES]).toEqual(['email']);
    expect(Object.isFrozen(GOOGLE_SCOPES) && Object.isFrozen(APPLE_SCOPES)).toBe(true);
  });

  it('Google sign-in and re-sign-in ask the token source for openid + email only (no profile)', async () => {
    const { svc, google } = service();
    await svc.signInWithGoogle();
    await svc.reauthenticate({ method: 'google' });
    expect(google.getIdToken).toHaveBeenCalledTimes(2);
    for (const [req] of google.getIdToken.mock.calls) {
      expect([...req.scopes]).toEqual(['openid', 'email']);
      expect(req.scopes).not.toContain('profile');
    }
  });

  it('Apple sign-in asks for email only (no full name) and uses a hashed nonce', async () => {
    const { svc, apple } = service();
    await svc.signInWithApple();
    const r = await svc.reauthenticate({ method: 'apple' });
    for (const [req] of apple.signIn.mock.calls) {
      expect([...req.scopes]).toEqual(['email']);
      expect(req.hashedNonce).toBe(`sha256(${'ab'.repeat(32)})`);
    }
    // Firebase gets the RAW nonce; Apple only ever saw its hash.
    expect(mockCalls.appleCred).toEqual({ idToken: 'apple-id-token', rawNonce: 'ab'.repeat(32) });
    expect(r.appleAuthorizationCode).toBe('code-1');
  });

  it('a build without the native modules offers email only and refuses the others', async () => {
    const { createAuthService: make } = jest.requireActual<typeof import('../authService')>('../authService');
    const { unavailableApple, unavailableGoogle } = jest.requireActual<typeof import('../ports')>('../ports');
    const svc = make({ auth, google: unavailableGoogle, apple: unavailableApple, crypto: { randomHex: () => '', sha256Hex: async () => '' }, logger });
    expect(svc.methods()).toEqual({ email: true, google: false, apple: false });
    await expect(svc.signInWithGoogle()).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(svc.signInWithApple()).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
