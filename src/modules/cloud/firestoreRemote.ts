/**
 * RemoteBackend on the Firebase JS SDK (Firestore). The sync engine never
 * imports Firebase; this adapter is the only Firestore code in the app
 * besides P2a's deletion module.
 *
 * - Reads come from the SERVER (getDocFromServer / getDocsFromServer), so
 *   an empty or stale cache is never mistaken for cloud state.
 * - The SDK keeps writes queued while offline and resolves commit() only
 *   when the server answers. A timeout turns that into 'deadline-exceeded'
 *   so a sync never hangs; if the queued write lands later, the engine's
 *   lost-ack check recognises it.
 * - Errors are reduced to a code (server messages are never kept: they
 *   could echo data).
 */
import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';

import { isTimestampLike, RemoteError, SERVER_TIME, type RemoteBackend, type RemoteDoc, type RemoteErrorCode } from '@/modules/sync';

const KNOWN: readonly RemoteErrorCode[] = ['permission-denied', 'unavailable', 'unauthenticated', 'resource-exhausted', 'deadline-exceeded', 'invalid-argument'];

export function toRemoteError(e: unknown): RemoteError {
  if (e instanceof RemoteError) return e;
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  if (typeof code === 'string') {
    if ((KNOWN as readonly string[]).includes(code)) return new RemoteError(code as RemoteErrorCode);
    if (code === 'not-found') return new RemoteError('permission-denied'); // the rules hide existence
    if (code === 'failed-precondition') return new RemoteError('invalid-argument');
  }
  return new RemoteError('unknown');
}

/** Engine values -> SDK values (server time sentinel, timestamps, lists of timestamps). */
export function toSdkValue(v: unknown): unknown {
  if (v === SERVER_TIME) return serverTimestamp();
  if (v instanceof Timestamp) return v;
  if (isTimestampLike(v)) return new Timestamp(v.seconds, v.nanoseconds);
  if (Array.isArray(v)) return v.map(toSdkValue);
  return v;
}

const toSdkData = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toSdkValue(v)]));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new RemoteError('deadline-exceeded')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function createFirestoreRemote(db: Firestore, opts: { timeoutMs?: number } = {}): RemoteBackend {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  return {
    async get(c, id) {
      try {
        const snap = await withTimeout(getDocFromServer(doc(db, c, id)), timeoutMs);
        return snap.exists() ? { id: snap.id, data: snap.data() } : null;
      } catch (e) {
        const err = toRemoteError(e);
        if (err.code === 'permission-denied') return null; // missing or not ours: the rules don't say which
        throw err;
      }
    },

    async commit(writes) {
      if (writes.length === 0) return;
      const batch = writeBatch(db);
      for (const w of writes) {
        const ref = doc(db, w.collection, w.id);
        if (w.op === 'set') batch.set(ref, toSdkData(w.data));
        else if (w.op === 'update') batch.update(ref, toSdkData(w.data));
        else batch.delete(ref);
      }
      try {
        await withTimeout(batch.commit(), timeoutMs);
      } catch (e) {
        throw toRemoteError(e);
      }
    },

    async query(spec) {
      const cons: QueryConstraint[] = [where('owner', '==', spec.uid)];
      if (spec.since) cons.push(where(spec.field, '>=', new Timestamp(spec.since.seconds, spec.since.nanoseconds)));
      cons.push(orderBy(spec.field), orderBy(documentId()));
      if (spec.after) cons.push(startAfter(new Timestamp(spec.after.time.seconds, spec.after.time.nanoseconds), spec.after.id));
      cons.push(limit(spec.limit));
      try {
        const snap = await withTimeout(getDocsFromServer(query(collection(db, spec.collection), ...cons)), timeoutMs);
        return snap.docs.map((d): RemoteDoc => ({ id: d.id, data: d.data() }));
      } catch (e) {
        throw toRemoteError(e);
      }
    },
  };
}
