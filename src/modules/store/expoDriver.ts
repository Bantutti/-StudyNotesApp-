/**
 * expo-sqlite adapter (works in Expo Go; no SQLCipher, decision Q5).
 * The database file lives in the app's private documents area.
 */
import * as SQLite from 'expo-sqlite';

import type { SqlDriver, SqlRow, SqlValue } from './sql';

export const DB_FILE = 'studynotes.db';

export async function openExpoDriver(name: string = DB_FILE): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  return {
    exec: (sql) => db.execAsync(sql),
    async run(sql, params) {
      const r = await db.runAsync(sql, params as SqlValue[]);
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowId) };
    },
    get: (sql, params) => db.getFirstAsync<SqlRow>(sql, params as SqlValue[]),
    all: (sql, params) => db.getAllAsync<SqlRow>(sql, params as SqlValue[]),
    close: () => db.closeAsync(),
  };
}

/** Deletes the database file (used by "Delete all data", after the store closed it). */
export async function deleteExpoDatabase(name: string = DB_FILE): Promise<void> {
  await SQLite.deleteDatabaseAsync(name);
}
