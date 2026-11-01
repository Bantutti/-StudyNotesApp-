/**
 * Settings storage.
 * - kv: device-local, namespaced values (onboarding done, last opened note,
 *   P3b's usage meter later). Never synced.
 * - profile: users/{uid}.settings, the small synced settings object
 *   (8,000 chars max, P2a). Unknown keys are kept (a newer app version may
 *   have written them).
 */
import * as z from 'zod';

import { AppError, refIdSchema, SETTINGS_MAX_CHARS, type Logger } from '@/core';

import { str } from './rows';
import type { SqlExecutor } from './sql';

const NS = /^[a-z0-9_.-]{1,40}$/;
const KEY = /^[A-Za-z0-9_.:-]{1,80}$/;
export const KV_MAX_CHARS = 16_000;
export const LOCAL_USER_ID = 'local';

export const userSettingsSchema = z.looseObject({
  /** Default style pack for new notes outside a subject with its own default. */
  defaultPack: refIdSchema.optional(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export function createKvRepo(deps: { now: () => number; logger: Logger }) {
  const check = (ns: string, key: string) => {
    if (!NS.test(ns) || !KEY.test(key)) throw new AppError('validation_failed', 'Invalid setting name.');
  };
  return {
    async get<T>(ex: SqlExecutor, ns: string, key: string, schema: z.ZodType<T>): Promise<T | null> {
      check(ns, key);
      const r = await ex.get('SELECT value FROM kv WHERE ns = ? AND key = ?', [ns, key]);
      if (!r) return null;
      try {
        const parsed = schema.safeParse(JSON.parse(str(r.value)));
        if (parsed.success) return parsed.data;
      } catch {
        // fall through
      }
      deps.logger.warn('store.kv_invalid', { ns });
      return null;
    },
    async set(ex: SqlExecutor, ns: string, key: string, value: unknown): Promise<void> {
      check(ns, key);
      const json = JSON.stringify(value);
      if (json === undefined || json.length > KV_MAX_CHARS) throw new AppError('too_large', 'This setting is too large.');
      await ex.run(
        'INSERT INTO kv (ns, key, value, updated) VALUES (?, ?, ?, ?) ON CONFLICT (ns, key) DO UPDATE SET value = excluded.value, updated = excluded.updated',
        [ns, key, json, deps.now()],
      );
    },
    async remove(ex: SqlExecutor, ns: string, key: string): Promise<void> {
      check(ns, key);
      await ex.run('DELETE FROM kv WHERE ns = ? AND key = ?', [ns, key]);
    },
  };
}

export function createProfileRepo(deps: { now: () => number; logger: Logger }) {
  const getSettings = async (ex: SqlExecutor): Promise<UserSettings> => {
    const r = await ex.get('SELECT settings FROM users ORDER BY created LIMIT 1');
    try {
      const parsed = userSettingsSchema.safeParse(JSON.parse(str(r?.settings) || '{}'));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through
    }
    deps.logger.warn('store.settings_invalid');
    return {};
  };
  return {
    getSettings,
    async ensure(ex: SqlExecutor): Promise<void> {
      const t = deps.now();
      await ex.run("INSERT OR IGNORE INTO users (id, owner, schemaVersion, created, updated, rev, settings) VALUES (?, NULL, 1, ?, ?, 0, '{}')", [
        LOCAL_USER_ID,
        t,
        t,
      ]);
    },
    async updateSettings(tx: SqlExecutor, patch: Partial<UserSettings>): Promise<UserSettings> {
      const cur = await getSettings(tx);
      const next = userSettingsSchema.safeParse({ ...cur, ...patch });
      if (!next.success) throw new AppError('validation_failed', 'Those settings are not valid.');
      const json = JSON.stringify(next.data);
      if (json.length > SETTINGS_MAX_CHARS) throw new AppError('too_large', 'Settings are too large.');
      await tx.run('UPDATE users SET settings = ?, updated = ?', [json, deps.now()]);
      return next.data;
    },
  };
}
