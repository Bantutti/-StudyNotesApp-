/**
 * Two-device ink merge (decision Q10, docs/modules/INK_MATH.md §10).
 *
 *   gone   = union of both tombstone sets (same id: keep the later time)
 *   strokes = union of both stroke sets by id, minus every id in gone
 *   order  = by (created time, id), so both devices get the same z-order
 *
 * Because strokes are immutable (an edit = tombstone + new id), this is a
 * state-based CRDT: merge is commutative, associative and idempotent (§10.1),
 * so devices converge no matter in which order copies meet. A tombstone always
 * beats a live copy (§10.2). Tombstone compaction (oldest first beyond 5,000)
 * is the one documented exception: a stroke deleted long ago could come back
 * from a device that has been offline for thousands of deletions (§10.3).
 */
import { AppError, fail, ok, type Result } from '@/core';

import { serializeInk, type InkLayer, type InkStroke, type InkTombstone } from './format';
import { compactTombstones, totalPoints } from './layer';
import { INK_LIMITS } from './limits';

const byTimeThenId = (a: InkStroke, b: InkStroke) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Same id on both sides (should be identical): pick deterministically by canonical JSON. */
function pick(a: InkStroke, b: InkStroke): InkStroke {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  return ja <= jb ? a : b;
}

export function mergeInkLayers(a: InkLayer, b: InkLayer): Result<InkLayer> {
  if (a.note !== b.note) return fail(new AppError('validation_failed', 'These drawings belong to different notes.'));

  const gone = new Map<string, InkTombstone>();
  for (const g of [...a.gone, ...b.gone]) {
    const cur = gone.get(g.id);
    if (!cur || g.t > cur.t) gone.set(g.id, g);
  }

  const strokes = new Map<string, InkStroke>();
  for (const s of [...a.strokes, ...b.strokes]) {
    if (gone.has(s.id)) continue;
    const cur = strokes.get(s.id);
    strokes.set(s.id, cur ? pick(cur, s) : s);
  }

  const merged: InkLayer = {
    ...a,
    strokes: [...strokes.values()].sort(byTimeThenId),
    gone: compactTombstones([...gone.values()]).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
  };
  // Both inputs fit, but their union might not: refuse rather than truncate silently.
  if (
    merged.strokes.length > INK_LIMITS.maxStrokes ||
    totalPoints(merged.strokes) > INK_LIMITS.maxTotalPoints ||
    serializeInk(merged).length > INK_LIMITS.maxFileBytes
  ) {
    return fail(new AppError('too_large', 'These drawings are too large to combine.'));
  }
  return ok(merged);
}
