/**
 * In-memory cloud with the SAME rules as firebase/firestore.rules, for unit
 * tests and the two-device simulations (the emulator suite checks the real
 * thing). Field validation uses P2a's zod schemas, which the P2a agreement
 * test proves equal to the rules; the lifecycle rules are re-implemented:
 *
 *  - every request needs a signed-in, email-verified user;
 *  - owner == uid on every read and write; queries are owner-scoped, <= 500;
 *  - create: id == doc id, rev 1, created == updated == server time,
 *    deleted false, and an active profile (exists, not mid-deletion);
 *  - update: id/owner/created unchanged, rev == old + 1, updated == server
 *    time, active profile; `set` on an existing doc is an update;
 *  - review logs are create-only; hard delete only for tombstones or while
 *    account deletion runs;
 *  - batches are atomic, and rules read the state BEFORE the batch (so the
 *    profile must be committed before the first other write).
 * Server times have microsecond precision, like Firestore.
 */
import type { BlobStorePort } from './assets';
import { ASSET_FOLDER, COLLECTION_SCHEMAS, QUERY_LIMIT_MAX, REVIEW_FUTURE_SKEW_MS, STORAGE, userSchema } from './cloudSchemas';
import { RemoteError, SERVER_TIME, type CloudCollection, type QuerySpec, type RemoteBackend, type RemoteDoc, type RemoteWrite } from './ports';
import { CloudTime, compareTime, isTimestampLike } from './time';

type Data = Record<string, unknown>;

export interface FakeAuth {
  uid: string;
  emailVerified: boolean;
}

export interface FakeCloud {
  /** A device's connection, acting as `auth` (null = signed out). */
  client(auth: () => FakeAuth | null): RemoteBackend & FakeClientControls;
  /** A device's Cloud Storage connection, with storage.rules' upload checks. */
  blobs(auth: () => FakeAuth | null): BlobStorePort & { setOnline(online: boolean): void };
  /** Admin view of Storage. */
  files(): Map<string, Uint8Array>;
  /** Admin view (no rules), for assertions. */
  peek(collection: CloudCollection, id: string): Data | undefined;
  all(collection: CloudCollection): RemoteDoc[];
  /** Admin write (no rules), to plant bad or foreign data in tests. */
  adminSet(collection: CloudCollection, id: string, data: Data): void;
  adminDelete(collection: CloudCollection, id: string): void;
  /** Total stored docs, for "account deletion leaves nothing". */
  count(): number;
  stats: { reads: number; writes: number; commits: number };
}

export interface FakeClientControls {
  setOnline(online: boolean): void;
  /** The next commit is applied on the server but the reply is lost (the device sees `unavailable`). */
  loseNextAck(): void;
}

const COLLECTIONS: readonly CloudCollection[] = ['users', ...Object.keys(COLLECTION_SCHEMAS)] as CloudCollection[];

function denied(): never {
  throw new RemoteError('permission-denied');
}

interface SafeParser {
  safeParse(v: unknown): { success: boolean };
}
const schemaOf = (c: CloudCollection) => (c === 'users' ? userSchema : COLLECTION_SCHEMAS[c]) as SafeParser;

export function createFakeCloud(opts: { now?: () => number } = {}): FakeCloud {
  const now = opts.now ?? Date.now;
  const store = new Map<CloudCollection, Map<string, Data>>(COLLECTIONS.map((c) => [c, new Map()]));
  const stats = { reads: 0, writes: 0, commits: 0 };
  const blobStore = new Map<string, Uint8Array>();
  let lastMicros = 0;

  /** Strictly increasing server time with microseconds (never ms-aligned). */
  const serverTime = (): CloudTime => {
    const micros = Math.max(now() * 1000 + 1, lastMicros + 1);
    lastMicros = micros;
    const seconds = Math.floor(micros / 1_000_000);
    return new CloudTime(seconds, (micros - seconds * 1_000_000) * 1000);
  };

  const col = (c: CloudCollection) => {
    const m = store.get(c);
    if (!m) throw new RemoteError('invalid-argument');
    return m;
  };

  const resolve = (data: Data, t: CloudTime): Data => {
    const out: Data = {};
    for (const [k, v] of Object.entries(data)) out[k] = v === SERVER_TIME ? t : v;
    return out;
  };

  const sameTime = (a: unknown, b: unknown) => isTimestampLike(a) && isTimestampLike(b) && compareTime(a, b) === 0;

  const client = (authOf: () => FakeAuth | null) => {
    let online = true;
    let loseAck = false;

    const requireAuth = (): FakeAuth => {
      if (!online) throw new RemoteError('unavailable');
      const a = authOf();
      if (!a) throw new RemoteError('unauthenticated');
      if (!a.emailVerified) denied();
      return a;
    };

    /** Evaluates one write against the pre-batch state; returns the doc to store (or null for a delete). */
    const evaluate = (w: RemoteWrite, uid: string, t: CloudTime): { c: CloudCollection; id: string; next: Data | null } => {
      const docs = col(w.collection);
      const old = docs.get(w.id);
      const profile = col('users').get(uid);
      const active = !!profile && profile.deletionRequestedAt == null;
      const deleting = !!profile && profile.deletionRequestedAt != null;

      if (w.op === 'delete') {
        if (!old || old.owner !== uid) denied();
        if (w.collection === 'users') {
          if (w.id !== uid || old.deletionRequestedAt == null) denied();
        } else if (w.collection === 'reviewLogs') {
          const card = col('cards').get(String(old.card));
          const tomb = !!card && card.owner === uid && card.deleted === true;
          if (!deleting && !tomb) denied();
        } else if (!(old.deleted === true || deleting)) denied();
        return { c: w.collection, id: w.id, next: null };
      }

      const incoming = resolve(w.data, t);
      const next = w.op === 'update' ? (old ? { ...old, ...incoming } : denied()) : incoming;
      if (!schemaOf(w.collection).safeParse(next).success) denied();

      if (w.collection === 'users') {
        if (w.id !== uid || next.id !== uid || next.owner !== uid) denied();
        if (!old) {
          if (!sameTime(next.created, t) || !sameTime(next.updated, t) || next.rev !== 1 || next.deletionRequestedAt !== null) denied();
        } else {
          if (!sameTime(next.created, old.created) || !sameTime(next.updated, t) || next.rev !== Number(old.rev) + 1) denied();
          const d = next.deletionRequestedAt;
          if (!(d === null || sameTime(d, t) || sameTime(d, old.deletionRequestedAt) || d === old.deletionRequestedAt)) denied();
        }
        return { c: 'users', id: w.id, next };
      }

      if (w.collection === 'reviewLogs') {
        if (old) denied(); // an existing id is an update: always denied (union merge stays idempotent)
        if (next.id !== w.id || next.owner !== uid || !sameTime(next.created, t) || !active) denied();
        const reviewed = next.reviewedAt;
        if (!isTimestampLike(reviewed) || reviewed.toMillis() > t.toMillis() + REVIEW_FUTURE_SKEW_MS) denied();
        return { c: w.collection, id: w.id, next };
      }

      if (!old) {
        if (next.id !== w.id || next.owner !== uid || next.rev !== 1 || next.deleted !== false) denied();
        if (!sameTime(next.created, t) || !sameTime(next.updated, t) || !active) denied();
      } else {
        if (old.owner !== uid || next.id !== old.id || next.owner !== old.owner) denied();
        if (!sameTime(next.created, old.created) || !sameTime(next.updated, t)) denied();
        if (next.rev !== Number(old.rev) + 1 || !active) denied();
      }
      return { c: w.collection, id: w.id, next };
    };

    const backend: RemoteBackend & FakeClientControls = {
      setOnline(v) {
        online = v;
      },
      loseNextAck() {
        loseAck = true;
      },

      async get(c, id) {
        const a = requireAuth();
        stats.reads += 1;
        const d = col(c).get(id);
        if (!d || d.owner !== a.uid) return null; // rules: permission-denied, mapped to "not readable"
        return { id, data: { ...d } };
      },

      async commit(writes) {
        const a = requireAuth();
        if (writes.length > 500) throw new RemoteError('invalid-argument');
        stats.commits += 1;
        const t = serverTime();
        const results = writes.map((w) => evaluate(w, a.uid, t)); // throws: nothing applied
        for (const r of results) {
          if (r.next === null) col(r.c).delete(r.id);
          else col(r.c).set(r.id, r.next);
        }
        stats.writes += writes.length;
        if (loseAck) {
          loseAck = false;
          throw new RemoteError('unavailable');
        }
      },

      async query(spec: QuerySpec) {
        const a = requireAuth();
        if (spec.uid !== a.uid || spec.limit > QUERY_LIMIT_MAX || spec.limit < 1) denied();
        const rows = [...col(spec.collection).entries()]
          .filter(([, d]) => d.owner === a.uid)
          .map(([id, d]) => ({ id, data: { ...d }, t: d[spec.field] }))
          .filter((r): r is { id: string; data: Data; t: CloudTime } => isTimestampLike(r.t))
          .filter((r) => !spec.since || compareTime(r.t, spec.since) >= 0)
          .sort((x, y) => compareTime(x.t, y.t) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
          .filter((r) => {
            if (!spec.after) return true;
            const c = compareTime(r.t, spec.after.time);
            return c > 0 || (c === 0 && r.id > spec.after.id);
          })
          .slice(0, spec.limit);
        stats.reads += Math.max(1, rows.length);
        return rows.map(({ id, data }) => ({ id, data }));
      },
    };
    return backend;
  };

  return {
    client,
    peek: (c, id) => {
      const d = col(c).get(id);
      return d ? { ...d } : undefined;
    },
    all: (c) => [...col(c).entries()].map(([id, data]) => ({ id, data: { ...data } })),
    adminSet: (c, id, data) => {
      col(c).set(id, data);
    },
    adminDelete: (c, id) => {
      col(c).delete(id);
    },
    count: () => [...store.values()].reduce((n, m) => n + m.size, 0) + blobStore.size,
    stats,
    files: () => blobStore,
    blobs: (authOf) => {
      let online = true;
      const who = () => {
        if (!online) throw new RemoteError('unavailable');
        const a = authOf();
        if (!a) throw new RemoteError('unauthenticated');
        if (!a.emailVerified) denied();
        return a;
      };
      const ownPath = (uid: string, path: string) => path.startsWith(`users/${uid}/`);
      return {
        setOnline(v: boolean) {
          online = v;
        },
        async upload(path, bytes, contentType) {
          const a = who();
          const m = /^users\/([^/]+)\/([a-z]+)\/([A-Za-z0-9_-]{16,64})\.([a-z0-9]+)$/.exec(path);
          if (!m || m[1] !== a.uid) denied();
          const folder = m[2] as keyof typeof STORAGE;
          const cap = STORAGE[folder];
          if (!cap || !(cap.contentTypes as readonly string[]).includes(contentType)) denied();
          if (bytes.length === 0 || bytes.length > cap.maxBytes) denied();
          const docData = col('assets').get(m[3] as string);
          const profile = col('users').get(a.uid);
          if (!profile || profile.deletionRequestedAt != null) denied();
          if (!docData || docData.owner !== a.uid || docData.deleted !== false) denied();
          if (docData.cloudPath !== path || docData.size !== bytes.length) denied();
          if (ASSET_FOLDER[docData.type as keyof typeof ASSET_FOLDER] !== folder) denied();
          blobStore.set(path, new Uint8Array(bytes));
        },
        async download(path) {
          const a = who();
          if (!ownPath(a.uid, path)) denied();
          const b = blobStore.get(path);
          return b ? new Uint8Array(b) : null;
        },
        async remove(path) {
          const a = who();
          if (!ownPath(a.uid, path)) denied();
          blobStore.delete(path);
        },
      };
    },
  };
}
