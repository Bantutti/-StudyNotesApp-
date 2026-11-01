/**
 * Public interface of the deletion module (rule 2: small index, internals hidden).
 * Kept separate from src/index.ts because it imports the Firebase JS SDK,
 * while the schemas are SDK-free.
 */
export {
  deleteAccount,
  NotSignedInError,
  ReauthRequiredError,
  type DeletionDeps,
  type DeletionOptions,
  type DeletionProgress,
  type DeletionReport,
  type DeletionStep,
} from './deleteAccount.js';
