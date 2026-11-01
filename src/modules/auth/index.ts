/**
 * auth: sign-in for sync (P2b). Public interface only; see docs/modules/auth.md.
 * Screens use AuthService and never import Firebase.
 */
export {
  createAuthService,
  toAuthError,
  AuthError,
  emailSchema,
  passwordSchema,
  type AuthService,
  type AuthServiceDeps,
  type AuthState,
  type AuthReason,
  type AuthProviderId,
  type ReauthInput,
} from './authService';
export { GOOGLE_SCOPES, APPLE_SCOPES, FORBIDDEN_SCOPES } from './scopes';
export {
  unavailableGoogle,
  unavailableApple,
  type GoogleTokenSource,
  type GoogleTokenRequest,
  type AppleTokenSource,
  type AppleTokenRequest,
  type AppleTokenResult,
  type CryptoPort,
} from './ports';
export { createSecureKeyValue, encodeKey, CHUNK_CHARS, type SecureStorePort, type AsyncKeyValue } from './securePersistence';
export { bindAccount, pauseSyncForSignOut, type BindResult } from './binding';
