/** What every sync step needs (dependency injection, no globals). */
import type { IdGenerator, Logger } from '@/core';
import { hash53 } from '@/modules/store';

import { contentKey } from './mapping';
import type { LocalReplica, RemoteBackend } from './ports';

export interface SyncContext {
  local: LocalReplica;
  remote: RemoteBackend;
  /** The signed-in, verified account. */
  uid: string;
  ids: IdGenerator;
  now: () => number;
  /** Logs codes and counts only, never content, titles, emails or tokens (MERGE_NOTES §6.5.9). */
  logger: Logger;
  /** Overrides for tests (small pages to exercise paging). */
  limits?: Partial<SyncLimits>;
}

export type SyncLimits = { -readonly [K in keyof typeof SYNC_LIMITS]: number };

export const limitsOf = (ctx: SyncContext): SyncLimits => ({ ...SYNC_LIMITS, ...ctx.limits });

/** Sync tuning. Small numbers keep each request cheap on the free tier. */
export const SYNC_LIMITS = {
  /** Outbox items prepared per round, and writes per batch (rules allow 500). */
  batchSize: 200,
  /** Upload rounds per push (a safety stop, not a normal limit). */
  maxRounds: 25,
  /** Docs per pull page (rules allow 500). */
  pageSize: 200,
  /** Pages per collection per pull (a safety stop). */
  maxPages: 100,
  /** Pulls re-read this much before the cursor; applying is idempotent. */
  overlapMs: 60_000,
} as const;

/** Hash of a document's content fields (never logged; compared only). */
export const contentHash = (doc: Record<string, unknown>): string => hash53(contentKey(doc));

/** The account was deleted (or deletion started) from another device. */
export class AccountGoneError extends Error {
  override name = 'AccountGoneError';
  constructor() {
    super('account_gone');
  }
}
