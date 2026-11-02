/** The ONE place the app imports P2a's deletion module (firebase/src/deletion; decision Q14). */
export {
  deleteAccount,
  NotSignedInError,
  ReauthRequiredError,
  type DeletionDeps,
  type DeletionOptions,
  type DeletionProgress,
  type DeletionReport,
} from '../../../firebase/src/deletion';
