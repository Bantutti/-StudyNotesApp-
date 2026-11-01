/**
 * node:sqlite driver for tests (SQLite 3.53 with FTS5 in Node 24).
 * Never imported by app code: Metro would not bundle node:sqlite.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SqlDriver, SqlRow, SqlValue } from '../src/modules/store/sql';

const plain = (r: unknown): SqlRow => ({ ...(r as object) }) as SqlRow;

export function nodeSqliteDriver(path = ':memory:'): SqlDriver & { raw: DatabaseSync } {
  const db = new DatabaseSync(path);
  const bind = (p: readonly SqlValue[]) => p as SQLInputValue[];
  return {
    raw: db,
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params) => {
      const r = db.prepare(sql).run(...bind(params));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    get: async (sql, params) => {
      const r = db.prepare(sql).get(...bind(params));
      return r === undefined ? null : plain(r);
    },
    all: async (sql, params) => db.prepare(sql).all(...bind(params)).map(plain),
    close: async () => {
      db.close();
    },
  };
}
