/**
 * sync: local SQLite <-> Firestore (P2b). Public interface only.
 * See docs/modules/sync.md.
 */
export { createSyncEngine, type SyncEngine, type SyncPhase, type SyncStatus, type SyncRunResult } from './engine';
export { type SyncContext, SYNC_LIMITS, AccountGoneError } from './context';
export {
  RemoteError,
  SERVER_TIME,
  TRANSIENT_CODES,
  type CloudCollection,
  type LocalReplica,
  type QuerySpec,
  type RemoteBackend,
  type RemoteDoc,
  type RemoteErrorCode,
  type RemoteWrite,
} from './ports';
export { CloudTime, compareTime, isTimestampLike } from './time';
export { listConflicts, resolveConflict, copyTitle, COPY_SUFFIX, type ConflictChoice, type ConflictView } from './conflicts';
export { RESOLVER_TABLES } from './resolve';
export { toCloudDoc, fromCloudDoc, eraseRow, planWrite } from './mapping';
export { createFakeCloud, type FakeCloud, type FakeAuth, type FakeClientControls } from './fakeRemote';
