/**
 * SQL port for the store.
 *
 * - SqlDriver is the raw adapter (expo-sqlite on devices, node:sqlite in
 *   tests). It knows nothing about locking.
 * - createSqlDb() wraps a driver so that every statement runs one at a time
 *   (a promise-chain mutex) and transactions are real BEGIN/COMMIT blocks
 *   that nothing else can interleave with. Nested transactions use
 *   SAVEPOINTs.
 *
 * Rules for callers (enforced by review and tests):
 * - Every statement uses `?` placeholders. SQL text is never built from
 *   user data. The only interpolations are integers from code
 *   (PRAGMA user_version) and fixed identifiers.
 * - Inside a transaction callback, use the `tx` handle, never the outer db
 *   (the outer db would wait for the lock the transaction holds).
 */
export type SqlValue = string | number | null;
export type SqlRow = Record<string, unknown>;

export interface SqlRunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params: readonly SqlValue[]): Promise<SqlRunResult>;
  get(sql: string, params: readonly SqlValue[]): Promise<SqlRow | null>;
  all(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]>;
  close(): Promise<void>;
}

export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;
  get<T extends SqlRow = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  all<T extends SqlRow = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Runs `fn` atomically (BEGIN IMMEDIATE, or a SAVEPOINT when nested). */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface SqlDb extends SqlExecutor {
  close(): Promise<void>;
}

export function createSqlDb(driver: SqlDriver): SqlDb {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;

  /** Queues `task` after everything already queued; errors don't break the chain. */
  const lock = <T>(task: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new Error('db_closed'));
    const next = tail.then(task, task);
    tail = next.catch(() => undefined);
    return next;
  };

  let savepoint = 0;
  const executor = (depth: number): SqlExecutor => ({
    exec: (sql) => driver.exec(sql),
    run: (sql, params = []) => driver.run(sql, params),
    get: <T extends SqlRow>(sql: string, params: readonly SqlValue[] = []) =>
      driver.get(sql, params) as Promise<T | null>,
    all: <T extends SqlRow>(sql: string, params: readonly SqlValue[] = []) =>
      driver.all(sql, params) as Promise<T[]>,
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const name = `sp_${++savepoint}`; // fixed identifier, never user data
      await driver.exec(`SAVEPOINT ${name}`);
      try {
        const out = await fn(executor(depth + 1));
        await driver.exec(`RELEASE ${name}`);
        return out;
      } catch (e) {
        await driver.exec(`ROLLBACK TO ${name}`);
        await driver.exec(`RELEASE ${name}`);
        throw e;
      }
    },
  });

  return {
    exec: (sql) => lock(() => driver.exec(sql)),
    run: (sql, params = []) => lock(() => driver.run(sql, params)),
    get: <T extends SqlRow>(sql: string, params: readonly SqlValue[] = []) =>
      lock(() => driver.get(sql, params) as Promise<T | null>),
    all: <T extends SqlRow>(sql: string, params: readonly SqlValue[] = []) =>
      lock(() => driver.all(sql, params) as Promise<T[]>),
    transaction: <T>(fn: (tx: SqlExecutor) => Promise<T>) =>
      lock(async () => {
        await driver.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn(executor(1));
          await driver.exec('COMMIT');
          return out;
        } catch (e) {
          await driver.exec('ROLLBACK');
          throw e;
        }
      }),
    close: () =>
      lock(async () => {
        closed = true;
        await driver.close();
      }),
  };
}
