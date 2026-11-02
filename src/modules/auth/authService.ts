/**
 * Sign-in for sync (P2b, plan F1 "email with verification, Sign in with
 * Apple, Google"). Wraps Firebase Auth; screens never import Firebase.
 *
 * States: loading -> signedOut | unverified (email not yet verified: the
 * rules refuse every read and write) | ready (verified: sync may run).
 *
 * Privacy (C1): only the email is collected. After every sign-in, any name
 * or photo Firebase copied from Google or Apple is removed from the user
 * record (best effort; the provider's own record stays with Firebase, see
 * docs/modules/auth.md). Emails, passwords and tokens are never logged.
 *
 * Errors become AuthError with a stable `reason` and a short message that
 * doesn't reveal whether an account exists (no account enumeration).
 */
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type Auth,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import * as z from 'zod';

import { AppError, type Logger } from '@/core';

import type { AppleTokenSource, CryptoPort, GoogleTokenSource } from './ports';
import { APPLE_SCOPES, FORBIDDEN_SCOPES, GOOGLE_SCOPES } from './scopes';

export type AuthProviderId = 'password' | 'google.com' | 'apple.com';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'unverified'; uid: string; email: string | null; provider: AuthProviderId }
  | { status: 'ready'; uid: string; email: string | null; provider: AuthProviderId };

export type AuthReason =
  | 'invalid_input'
  | 'wrong_credentials'
  | 'email_in_use'
  | 'weak_password'
  | 'too_many_attempts'
  | 'network'
  | 'reauth_required'
  | 'cancelled'
  | 'unavailable'
  | 'disabled'
  | 'other_method'
  | 'unknown';

export class AuthError extends AppError {
  constructor(
    readonly reason: AuthReason,
    message: string,
  ) {
    super(reason === 'network' ? 'network' : reason === 'cancelled' ? 'cancelled' : reason === 'unavailable' ? 'unsupported' : 'permission_denied', message);
    this.name = 'AuthError';
  }
}

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
/** Firebase's minimum is 6; we ask for 8 (NIST 800-63B), and cap the length. */
export const passwordSchema = z.string().min(8).max(128);

const MESSAGES: Record<AuthReason, string> = {
  invalid_input: 'Check the email address and password.',
  wrong_credentials: 'That email and password don\u2019t match. Try again or reset your password.',
  email_in_use: 'This email can\u2019t be used for a new account. If it\u2019s yours, sign in instead.',
  weak_password: 'Use at least 8 characters for your password.',
  too_many_attempts: 'Too many tries. Wait a few minutes and try again.',
  network: 'You\u2019re offline. Connect to the internet and try again.',
  reauth_required: 'For your security, sign in again to continue.',
  cancelled: 'Sign-in was cancelled.',
  unavailable: 'This sign-in option isn\u2019t available in this version of the app.',
  disabled: 'This account is turned off.',
  other_method: 'This email uses a different sign-in method. Use that one instead.',
  unknown: 'Something went wrong with sign-in. Please try again.',
};

const fail = (reason: AuthReason): AuthError => new AuthError(reason, MESSAGES[reason]);

/** Maps Firebase Auth error codes to reasons (never keeps the server message). */
export function toAuthError(e: unknown): AuthError {
  if (e instanceof AuthError) return e;
  const code = typeof e === 'object' && e !== null ? String((e as { code?: unknown }).code ?? '') : '';
  switch (code) {
    case 'auth/invalid-email':
    case 'auth/missing-password':
    case 'auth/missing-email':
      return fail('invalid_input');
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-mismatch':
      return fail('wrong_credentials');
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
      return fail('email_in_use');
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return fail('weak_password');
    case 'auth/too-many-requests':
      return fail('too_many_attempts');
    case 'auth/network-request-failed':
    case 'auth/timeout':
      return fail('network');
    case 'auth/requires-recent-login':
    case 'auth/user-token-expired':
      return fail('reauth_required');
    case 'auth/user-disabled':
      return fail('disabled');
    case 'auth/account-exists-with-different-credential':
      return fail('other_method');
    case 'auth/operation-not-allowed':
      return fail('unavailable');
    default:
      return fail('unknown');
  }
}

function providerOf(user: User): AuthProviderId {
  const ids = user.providerData.map((p) => p.providerId);
  if (ids.includes('apple.com')) return 'apple.com';
  if (ids.includes('google.com')) return 'google.com';
  return 'password';
}

function stateOf(user: User | null): AuthState {
  if (!user) return { status: 'signedOut' };
  const base = { uid: user.uid, email: user.email, provider: providerOf(user) };
  return user.emailVerified ? { status: 'ready', ...base } : { status: 'unverified', ...base };
}

function assertScopes(scopes: readonly string[]): void {
  if (scopes.some((s) => FORBIDDEN_SCOPES.includes(s))) throw fail('unavailable');
}

export interface AuthServiceDeps {
  auth: Auth;
  google: GoogleTokenSource;
  apple: AppleTokenSource;
  crypto: CryptoPort;
  logger: Logger;
}

export type ReauthInput = { method: 'password'; password: string } | { method: 'google' } | { method: 'apple' };

export interface AuthService {
  state(): AuthState;
  subscribe(fn: (s: AuthState) => void): () => void;
  /** Methods this build can offer (Google/Apple need native modules; Q1). */
  methods(): { email: true; google: boolean; apple: boolean };
  signUpWithEmail(email: string, password: string): Promise<AuthState>;
  signInWithEmail(email: string, password: string): Promise<AuthState>;
  resendVerification(): Promise<void>;
  /** Reloads the user and refreshes the ID token (the rules read email_verified from it). */
  checkVerified(): Promise<AuthState>;
  /** Always resolves for a valid email, whether or not an account exists. */
  sendPasswordReset(email: string): Promise<void>;
  signInWithGoogle(): Promise<AuthState>;
  signInWithApple(): Promise<AuthState>;
  /** Fresh sign-in for sensitive actions (account deletion). Apple returns its authorization code (for revoke). */
  reauthenticate(input: ReauthInput): Promise<{ appleAuthorizationCode: string | null }>;
  signOut(): Promise<void>;
  currentUser(): User | null;
  /** Signs in with a credential built elsewhere (a native module later; the emulator's fake tokens in tests). Same scrub and checks. */
  signInWithCredential(cred: AuthCredential): Promise<AuthState>;
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { auth, logger } = deps;
  const log = logger.child('auth');
  let current: AuthState = { status: 'loading' };
  const subs = new Set<(s: AuthState) => void>();
  const set = (s: AuthState) => {
    current = s;
    subs.forEach((f) => f(s));
  };
  onIdTokenChanged(auth, (u) => set(stateOf(u)));

  /** Removes a name or photo copied from Google/Apple (data minimisation, C1). */
  const scrubProfile = async (user: User): Promise<void> => {
    if (user.displayName === null && user.photoURL === null) return;
    try {
      await updateProfile(user, { displayName: '', photoURL: '' });
      await user.reload();
    } catch {
      log.warn('profile_scrub_failed'); // retried after the next sign-in
    }
  };

  const after = async (user: User): Promise<AuthState> => {
    await scrubProfile(user);
    await user.getIdToken(true);
    const s = stateOf(auth.currentUser);
    set(s);
    log.info('signed_in', { provider: providerOf(user), verified: user.emailVerified });
    return s;
  };

  const requireUser = (): User => {
    const u = auth.currentUser;
    if (!u) throw fail('reauth_required');
    return u;
  };

  const parse = (email: string, password?: string) => {
    const e = emailSchema.safeParse(email);
    if (!e.success) throw fail('invalid_input');
    if (password !== undefined && !passwordSchema.safeParse(password).success) throw fail('weak_password');
    return e.data;
  };

  const googleCredential = async (): Promise<AuthCredential> => {
    if (!deps.google.available) throw fail('unavailable');
    assertScopes(GOOGLE_SCOPES);
    const idToken = await deps.google.getIdToken({ scopes: GOOGLE_SCOPES });
    if (!idToken) throw fail('cancelled');
    return GoogleAuthProvider.credential(idToken);
  };

  const appleCredential = async (): Promise<{ cred: AuthCredential; code: string | null }> => {
    if (!deps.apple.available) throw fail('unavailable');
    assertScopes(APPLE_SCOPES);
    const rawNonce = deps.crypto.randomHex(32);
    const hashedNonce = await deps.crypto.sha256Hex(rawNonce);
    const r = await deps.apple.signIn({ scopes: APPLE_SCOPES, hashedNonce });
    if (!r) throw fail('cancelled');
    return { cred: new OAuthProvider('apple.com').credential({ idToken: r.identityToken, rawNonce }), code: r.authorizationCode };
  };

  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      const err = toAuthError(e);
      if (err.reason !== 'cancelled') log.warn('auth_failed', { reason: err.reason });
      throw err;
    }
  };

  return {
    state: () => current,
    subscribe(fn) {
      subs.add(fn);
      fn(current);
      return () => {
        subs.delete(fn);
      };
    },
    methods: () => ({ email: true, google: deps.google.available, apple: deps.apple.available }),

    signUpWithEmail: (email, password) =>
      wrap(async () => {
        const e = parse(email, password);
        const cred = await createUserWithEmailAndPassword(auth, e, password);
        await sendEmailVerification(cred.user);
        return after(cred.user);
      }),

    signInWithEmail: (email, password) =>
      wrap(async () => {
        const e = emailSchema.safeParse(email);
        if (!e.success || password.length === 0 || password.length > 128) throw fail('wrong_credentials');
        const cred = await signInWithEmailAndPassword(auth, e.data, password);
        return after(cred.user);
      }),

    resendVerification: () =>
      wrap(async () => {
        await sendEmailVerification(requireUser());
      }),

    checkVerified: () =>
      wrap(async () => {
        const u = requireUser();
        await u.reload();
        await u.getIdToken(true);
        const s = stateOf(auth.currentUser);
        set(s);
        return s;
      }),

    sendPasswordReset: (email) =>
      wrap(async () => {
        const e = parse(email);
        try {
          await sendPasswordResetEmail(auth, e);
        } catch (err) {
          const r = toAuthError(err);
          if (r.reason !== 'wrong_credentials') throw r; // "no such user" looks like success
        }
      }),

    signInWithGoogle: () => wrap(async () => after((await signInWithCredential(auth, await googleCredential())).user)),

    signInWithApple: () => wrap(async () => after((await signInWithCredential(auth, (await appleCredential()).cred)).user)),

    reauthenticate: (input) =>
      wrap(async () => {
        const u = requireUser();
        if (input.method === 'password') {
          if (!u.email) throw fail('other_method');
          await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, input.password));
          return { appleAuthorizationCode: null };
        }
        if (input.method === 'google') {
          await reauthenticateWithCredential(u, await googleCredential());
          return { appleAuthorizationCode: null };
        }
        const { cred, code } = await appleCredential();
        await reauthenticateWithCredential(u, cred);
        return { appleAuthorizationCode: code };
      }),

    signOut: () =>
      wrap(async () => {
        await fbSignOut(auth);
        set({ status: 'signedOut' });
      }),

    currentUser: () => auth.currentUser,

    signInWithCredential: (cred) => wrap(async () => after((await signInWithCredential(auth, cred)).user)),
  };
}
