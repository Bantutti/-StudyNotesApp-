/**
 * Ports of the sync engine (rule 2: external services behind interfaces).
 *
 * - RemoteBackend: the cloud. firestoreRemote.ts implements it with the
 *   Firebase JS SDK; fakeRemote.ts implements it in memory with the same
 *   rules (rev + 1, owner, tombstones, deletion lock, atomic batches).
 * - LocalReplica: the device database. The store module's `store.sync`
 *   implements it (all SQL stays in the store).
 */
import type { StoreSync } from '@/modules/store';

import type { CollectionName, TimestampLike } from './cloudSchemas';

export type CloudCollection = CollectionName | 'users';

/** Write-time placeholder for "the server's clock" (serverTimestamp() in the SDK adapter). */
export const SERVER_TIME: unique symbol = Symbol('SERVER_TIME');
export type ServerTime = typeof SERVER_TIME;

/** A document as read: plain JSON values plus TimestampLike for timestamps. */
export interface RemoteDoc {
  id: string;
  data: Record<string, unknown>;
}

export type RemoteWrite =
  /** Full document. On an existing doc the rules treat it as an update (and refuse it). */
  | { op: 'set'; collection: CloudCollection; id: string; data: Record<string, unknown> }
  /** Partial update: never includes `created` (its server value has microseconds we don't keep). */
  | { op: 'update'; collection: CloudCollection; id: string; data: Record<string, unknown> }
  | { op: 'delete'; collection: CloudCollection; id: string };

export interface QuerySpec {
  collection: CollectionName;
  uid: string;
  /** reviewLogs are ordered by `created` (they have no `updated`). */
  field: 'updated' | 'created';
  /** Inclusive lower bound (the cursor minus the overlap), or null for everything. */
  since: TimestampLike | null;
  /** Page continuation: strictly after this (time, doc id). */
  after: { time: TimestampLike; id: string } | null;
  limit: number;
}

export type RemoteErrorCode =
  | 'permission-denied'
  | 'unavailable'
  | 'unauthenticated'
  | 'resource-exhausted'
  | 'deadline-exceeded'
  | 'invalid-argument'
  | 'unknown';

/** A cloud error with a stable code only (never a server message: it could echo data). */
export class RemoteError extends Error {
  override name = 'RemoteError';

  constructor(readonly code: RemoteErrorCode) {
    super(code);
  }
}

/** Errors that mean "try again later" (offline, timeouts, quota). */
export const TRANSIENT_CODES: readonly RemoteErrorCode[] = ['unavailable', 'deadline-exceeded', 'resource-exhausted', 'unknown'];

export interface RemoteBackend {
  /** One document, read from the SERVER (never a cache). null = missing or not readable (the rules hide which). */
  get(collection: CloudCollection, id: string): Promise<RemoteDoc | null>;
  /** Atomic batch (all or nothing), at most 500 writes. */
  commit(writes: readonly RemoteWrite[]): Promise<void>;
  /** owner == uid, field >= since, ordered by (field, doc id), from the server. */
  query(spec: QuerySpec): Promise<RemoteDoc[]>;
}

/** The device database as the sync engine sees it (implemented by store.sync). */
export type LocalReplica = StoreSync;
