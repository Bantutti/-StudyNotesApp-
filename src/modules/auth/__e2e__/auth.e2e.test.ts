/**
 * Auth on the emulator with the real Firebase JS SDK: email sign-up,
 * verification gate, wrong password, reset without enumeration, and the
 * Firebase half of Google and Apple (emulator fake ID tokens), including
 * removing the name and photo the provider copies in.
 */
import { GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';

import { createLogger, memorySink } from '@/core';
import type { CloudServices } from '@/modules/cloud';

import { clickVerificationLinks, cloudFor, resetEmulators } from '../../../../test/e2e/emulator';
import { createAuthService, unavailableApple, unavailableGoogle, type AuthService } from '../index';

const logs = memorySink(500);
const logger = createLogger({ sink: logs, minLevel: 'debug' });
const crypto = { randomHex: () => 'cd'.repeat(32), sha256Hex: async (s: string) => s };
let cloud: CloudServices;
let auth: AuthService;

beforeEach(async () => {
  await resetEmulators();
  cloud = cloudFor('auth');
  auth = createAuthService({ auth: cloud.auth, google: unavailableGoogle, apple: unavailableApple, crypto, logger });
});
afterEach(async () => {
  await cloud.close();
});

const email = () => `student.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com`;
const PW = 'correct horse battery 9';

describe('email sign-in (fully built)', () => {
  it('sign-up is "unverified" (cloud refuses it) until the link is clicked, then "ready"', async () => {
    const e = email();
    const s = await auth.signUpWithEmail(e, PW);
    expect(s).toMatchObject({ status: 'unverified', email: e, provider: 'password' });
    await expect(getDocFromServer(doc(cloud.firestore, 'users', s.status === 'unverified' ? s.uid : ''))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await auth.checkVerified()).toMatchObject({ status: 'unverified' });
    expect(await clickVerificationLinks(e)).toBe(1);
    expect(await auth.checkVerified()).toMatchObject({ status: 'ready' });
  });

  it('wrong password and unknown email give the same answer', async () => {
    const e = email();
    await auth.signUpWithEmail(e, PW);
    await auth.signOut();
    const a = await auth.signInWithEmail(e, 'wrong password 1').catch((x: unknown) => x);
    const b = await auth.signInWithEmail(email(), PW).catch((x: unknown) => x);
    expect(a).toMatchObject({ reason: 'wrong_credentials' });
    expect(b).toMatchObject({ reason: 'wrong_credentials' });
    expect((a as Error).message).toBe((b as Error).message);
  });

  it('password reset resolves for unknown emails too (no account enumeration)', async () => {
    await expect(auth.sendPasswordReset(email())).resolves.toBeUndefined();
    await expect(auth.sendPasswordReset('nope')).rejects.toMatchObject({ reason: 'invalid_input' });
  });

  it('refuses short passwords before calling the server', async () => {
    await expect(auth.signUpWithEmail(email(), 'short')).rejects.toMatchObject({ reason: 'weak_password' });
  });

  it('re-sign-in with the password works (needed before account deletion)', async () => {
    const e = email();
    await auth.signUpWithEmail(e, PW);
    await expect(auth.reauthenticate({ method: 'password', password: PW })).resolves.toEqual({ appleAuthorizationCode: null });
    await expect(auth.reauthenticate({ method: 'password', password: 'wrong password 1' })).rejects.toMatchObject({ reason: 'wrong_credentials' });
  });

  it('never logs the email or password', async () => {
    const e = email();
    await auth.signUpWithEmail(e, PW);
    await auth.signInWithEmail(e, 'wrong password 1').catch(() => undefined);
    const text = JSON.stringify(logs.records);
    expect(text).not.toContain(e);
    expect(text).not.toContain('wrong password');
  });
});

describe('Google and Apple: the Firebase half (emulator fake tokens)', () => {
  it('Google: verified at once, and the copied name and photo are removed', async () => {
    const fake = JSON.stringify({ sub: `g${Date.now()}`, email: email(), email_verified: true, name: 'Rey Student', picture: 'https://example.com/p.png' });
    const s = await auth.signInWithCredential(GoogleAuthProvider.credential(fake));
    expect(s).toMatchObject({ status: 'ready', provider: 'google.com' });
    const u = auth.currentUser();
    expect(u?.displayName ?? null).toBeNull();
    expect(u?.photoURL ?? null).toBeNull();
    // Known limit (docs/modules/auth.md, reported to C1): Firebase keeps the
    // provider's own copy (providerData). Without a profile scope a real Google
    // token carries no name, so this only shows up with fake tokens.
    expect(u?.providerData[0]?.displayName).toBe('Rey Student');
  });

  it('Apple: verified at once, no name kept', async () => {
    const fake = JSON.stringify({ sub: `a${Date.now()}`, email: email(), email_verified: true, name: 'Rey Student' });
    const s = await auth.signInWithCredential(new OAuthProvider('apple.com').credential({ idToken: fake, rawNonce: 'cd'.repeat(32) }));
    expect(s).toMatchObject({ status: 'ready', provider: 'apple.com' });
    expect(auth.currentUser()?.displayName ?? null).toBeNull();
  });
});
