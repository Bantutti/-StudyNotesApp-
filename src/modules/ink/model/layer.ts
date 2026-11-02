/**
 * Pure operations on an ink layer. Layers are treated as IMMUTABLE values:
 * every operation returns a new layer and never mutates its input, so undo,
 * merge and the React side can hold old layers safely.
 *
 * The one write primitive is applyOp({ remove, add }):
 *  - removing a stroke deletes it and records a tombstone (so a merge with an
 *    older copy on another device can't bring it back, §10.2);
 *  - adding a stroke whose id is already used or tombstoned gives it a FRESH
 *    id (strokes are immutable; a tombstoned id stays dead forever). The
 *    returned idMap lets the undo history follow the new ids.
 * Capacity (INK_LIMITS) is checked before anything changes: an op that would
 * overflow is refused as a whole and the layer is returned untouched.
 */
import { pointCount, type InkLayer, type InkStroke, type InkTombstone } from './format';
import { INK_LIMITS as L } from './limits';

/** An undoable change: strokes to remove and strokes to add, applied in that order. */
export interface InkOp {
  remove: readonly InkStroke[];
  add: readonly InkStroke[];
}

export interface OpContext {
  newStrokeId: () => string;
  now: () => number;
}

export type ApplyResult =
  | { ok: true; layer: InkLayer; applied: InkOp; idMap: ReadonlyMap<string, string> }
  | { ok: false; reason: 'full' };

/** Serialized size of one stroke, cached per object (strokes are immutable, §6.3). */
const bytesCache = new WeakMap<InkStroke, number>();
export function strokeBytes(s: InkStroke): number {
  let n = bytesCache.get(s);
  if (n === undefined) {
    n = JSON.stringify(s).length + 1; // + the separating comma
    bytesCache.set(s, n);
  }
  return n;
}

/** Envelope + tombstones: each tombstone is {"id":"s_<16..32>","t":<13 digits>} plus a comma (<= 60). */
const ENVELOPE_BYTES = 200;
const TOMBSTONE_BYTES = 60;

/** Upper estimate of serializeInk(layer).length without serializing. */
export function estimateLayerBytes(strokes: readonly InkStroke[], tombstones: number): number {
  let n = ENVELOPE_BYTES + tombstones * TOMBSTONE_BYTES;
  for (const s of strokes) n += strokeBytes(s);
  return n;
}

/** Total point count of a list of strokes. */
export function totalPoints(strokes: readonly InkStroke[]): number {
  let n = 0;
  for (const s of strokes) n += pointCount(s);
  return n;
}

/**
 * Keeps at most `max` tombstones, dropping the OLDEST first (ties: by id, so
 * the result is deterministic on every device, §10.3).
 */
export function compactTombstones(gone: readonly InkTombstone[], max: number = L.maxTombstones): InkTombstone[] {
  if (gone.length <= max) return gone.slice();
  return gone
    .slice()
    .sort((a, b) => b.t - a.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, max);
}

/** Applies { remove, add } as one step. See the file header for the rules. */
export function applyOp(layer: InkLayer, op: InkOp, ctx: OpContext): ApplyResult {
  const removeIds = new Set(op.remove.map((s) => s.id));
  const kept = layer.strokes.filter((s) => !removeIds.has(s.id));
  const actuallyRemoved = layer.strokes.filter((s) => removeIds.has(s.id));

  // Capacity check on the final state, before changing anything.
  if (kept.length + op.add.length > L.maxStrokes) return { ok: false, reason: 'full' };
  if (totalPoints(kept) + totalPoints(op.add) > L.maxTotalPoints) return { ok: false, reason: 'full' };
  // Bytes: tombstones are capped, so count the cap at most.
  const tomb = Math.min(L.maxTombstones, layer.gone.length + actuallyRemoved.length);
  if (estimateLayerBytes([...kept, ...op.add], tomb) > L.maxFileBytes) return { ok: false, reason: 'full' };

  const t = ctx.now();
  const goneById = new Map(layer.gone.map((g) => [g.id, g] as const));
  for (const s of actuallyRemoved) goneById.set(s.id, { id: s.id, t });

  // Fresh ids for re-added strokes whose id is already taken or dead.
  const used = new Set(kept.map((s) => s.id));
  const idMap = new Map<string, string>();
  const added: InkStroke[] = [];
  for (const s of op.add) {
    let id = s.id;
    while (used.has(id) || goneById.has(id)) id = ctx.newStrokeId();
    if (id !== s.id) idMap.set(s.id, id);
    used.add(id);
    added.push(id === s.id ? s : { ...s, id });
  }

  return {
    ok: true,
    layer: { ...layer, strokes: [...kept, ...added], gone: compactTombstones([...goneById.values()]) },
    applied: { remove: actuallyRemoved, add: added },
    idMap,
  };
}

/** The op that reverses `op` (undo). */
export function inverseOp(op: InkOp): InkOp {
  return { remove: op.add, add: op.remove };
}

/** Looks up live strokes by id (missing ids are skipped). */
export function strokesById(layer: InkLayer, ids: Iterable<string>): InkStroke[] {
  const want = new Set(ids);
  return layer.strokes.filter((s) => want.has(s.id));
}

/** Strokes whose anchor block is not in the document (hidden, kept for undo/restore/sync, decision Q4). */
export function detachedStrokes(layer: InkLayer, liveBlockIds: ReadonlySet<string>): InkStroke[] {
  return layer.strokes.filter((s) => !liveBlockIds.has(s.b));
}

/**
 * Purges detached strokes whose anchor no longer exists ANYWHERE it could
 * come back from: not in the current document and not in any saved version
 * (decision Q4). `recoverableBlockIds` = block ids of the current doc plus
 * every version kept in History. Purged strokes get tombstones.
 */
export function purgeUnrecoverable(layer: InkLayer, recoverableBlockIds: ReadonlySet<string>, ctx: OpContext): InkLayer {
  const dead = layer.strokes.filter((s) => !recoverableBlockIds.has(s.b));
  if (dead.length === 0) return layer;
  const r = applyOp(layer, { remove: dead, add: [] }, ctx);
  return r.ok ? r.layer : layer;
}
