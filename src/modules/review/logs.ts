/**
 * Append-only review logs and card rebuild.
 *
 * Logs are never edited. Two devices' logs merge by set union on log id,
 * then sort by (reviewedAt, id). Card state is always derived by replaying
 * the merged log, so there are no review conflicts to resolve.
 */
import * as z from 'zod';

import { snapshot, toRating, type Card, type CardSnapshot, type Grade, type Scheduler } from './scheduler';

export const reviewLogSchema = z.object({
  id: z.string().regex(/^l_[A-Za-z0-9]{10,32}$/),
  cardId: z.string().regex(/^c_[A-Za-z0-9]{10,32}$/),
  reviewedAt: z.iso.datetime(),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});
export type ReviewLog = z.infer<typeof reviewLogSchema>;

export function sortLogs(logs: readonly ReviewLog[]): ReviewLog[] {
  return [...logs].sort((a, b) =>
    a.reviewedAt < b.reviewedAt ? -1 : a.reviewedAt > b.reviewedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** Union by id. If two entries share an id, the first one wins (ids are unique by construction). */
export function mergeLogs(...sets: readonly (readonly ReviewLog[])[]): ReviewLog[] {
  const byId = new Map<string, ReviewLog>();
  for (const set of sets) for (const l of set) if (!byId.has(l.id)) byId.set(l.id, l);
  return sortLogs([...byId.values()]);
}

export function rebuildCard(
  scheduler: Scheduler,
  cardId: string,
  createdAt: Date,
  logs: readonly ReviewLog[],
): Card {
  let card = scheduler.newCard({ now: createdAt, cardId });
  for (const l of sortLogs(logs.filter((x) => x.cardId === cardId))) {
    card = scheduler.review({ card, grade: toRating(l.grade as Grade), now: new Date(l.reviewedAt) }).card;
  }
  return card;
}

export function rebuildSnapshot(
  scheduler: Scheduler,
  cardId: string,
  createdAt: Date,
  logs: readonly ReviewLog[],
): CardSnapshot {
  return snapshot(rebuildCard(scheduler, cardId, createdAt, logs));
}
