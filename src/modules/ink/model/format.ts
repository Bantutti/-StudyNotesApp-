/**
 * Ink file format v1 (one JSON file per note) and its loader.
 *
 * This file is the TRUST BOUNDARY for ink. Ink arrives from three untrusted
 * places: the local file system (could be damaged), Cloud Storage via P2b
 * (could be tampered with) and the editor bridge. Everything goes through
 * parseInkJson() / validateInkLayer(), in this order:
 *   1. size check on the raw string BEFORE JSON.parse (no huge allocations),
 *   2. zod strict objects (unknown keys rejected, every field typed),
 *   3. per-stroke checks zod can't express cheaply: point counts, matching
 *      pressure length, step size and cumulative coordinate bounds (§6.2),
 *   4. whole-layer checks: unique ids, stroke/point/tombstone caps, note id.
 * One bad stroke rejects the WHOLE file; the caller keeps its last good copy.
 *
 * Shape (see docs/modules/ink.md, "File format"):
 *   { kind: "notedpo-ink", v: 1, note, unit: 1000, strokes: [...], gone: [...] }
 * Stroke points are delta-encoded integers (codec.ts, §6).
 */
import * as z from 'zod';

import { AppError, BLOCK_ID, ENTITY_ID_PATTERN, fail, ok, utf8Length, type Result } from '@/core';

import {
  HEX_COLOR,
  HIGHLIGHTER_KEYS,
  INK_FORMAT_KIND,
  INK_FORMAT_VERSION,
  INK_LIMITS as L,
  INK_UNIT,
  PEN_KEYS,
  STROKE_ID,
} from './limits';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InkTool = 'pen' | 'hl';

/** Optional link to the moment in a recording when the stroke was drawn (filled by P4). */
export interface InkRecAnchor {
  /** recordings/{id} */
  r: string;
  /** ms from the start of that recording */
  ms: number;
}

/**
 * One stroke. Strokes are IMMUTABLE once committed: an edit (move, recolour,
 * partial erase, re-anchor) removes the old id (tombstone) and adds a new
 * one. That is what makes the two-device merge a plain set union (§10).
 */
export interface InkStroke {
  /** "s_" + random */
  id: string;
  /** Anchor block id (attrs.blockId in the note document). */
  b: string;
  tool: InkTool;
  /** Pack key (p0..p2 for pens, h0 for the highlighter) or "#RRGGBB". */
  c: string;
  /** Width in tenths of a unit. */
  w: number;
  /** First point [x, y] in units, relative to the anchor block's top-left corner. */
  o: [number, number];
  /** Remaining points as deltas [dx1, dy1, dx2, dy2, ...] (§6.1). */
  d: number[];
  /** Optional pressure 0..100, one value per point (first point included). */
  p?: number[];
  /** Created, ms since 1970. */
  t: number;
  rec?: InkRecAnchor;
}

/** A deleted stroke id, kept so a merge never brings it back (§10.2). */
export interface InkTombstone {
  id: string;
  t: number;
}

export interface InkLayer {
  kind: typeof INK_FORMAT_KIND;
  v: typeof INK_FORMAT_VERSION;
  /** The note this layer belongs to (checked on load). */
  note: string;
  unit: typeof INK_UNIT;
  strokes: InkStroke[];
  gone: InkTombstone[];
}

// ---------------------------------------------------------------------------
// zod schema (shape only; numeric arrays are checked in a single loop below,
// which is much faster than a zod check per number on 400k points)
// ---------------------------------------------------------------------------

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const time = int(0, L.maxTime);

const strokeSchema = z.strictObject({
  id: z.string().regex(STROKE_ID),
  b: z.string().regex(BLOCK_ID),
  tool: z.enum(['pen', 'hl']),
  c: z.string().max(7),
  w: int(L.minWidth, L.maxWidth),
  o: z.tuple([int(L.minX, L.maxX), int(L.minY, L.maxY)]),
  // Max length = (maxPoints - 1) * 2 deltas. Element checks happen in checkStroke().
  d: z.array(z.number()).max((L.maxPointsPerStroke - 1) * 2),
  p: z.array(z.number()).max(L.maxPointsPerStroke).optional(),
  t: time,
  rec: z
    .strictObject({
      r: z.string().regex(ENTITY_ID_PATTERN),
      ms: int(0, L.maxRecordingMs),
    })
    .optional(),
});

const layerSchema = z.strictObject({
  kind: z.literal(INK_FORMAT_KIND),
  v: z.literal(INK_FORMAT_VERSION),
  note: z.string().regex(ENTITY_ID_PATTERN),
  unit: z.literal(INK_UNIT),
  strokes: z.array(strokeSchema).max(L.maxStrokes),
  gone: z
    .array(z.strictObject({ id: z.string().regex(STROKE_ID), t: time }))
    .max(L.maxTombstones),
});

// ---------------------------------------------------------------------------
// Per-stroke checks
// ---------------------------------------------------------------------------

const PEN_KEY_SET: ReadonlySet<string> = new Set(PEN_KEYS);
const HL_KEY_SET: ReadonlySet<string> = new Set(HIGHLIGHTER_KEYS);

/** Pens use p0..p2, the highlighter uses h0; both may use a custom "#RRGGBB". */
export function colorAllowed(tool: InkTool, c: string): boolean {
  if (HEX_COLOR.test(c)) return true;
  return tool === 'pen' ? PEN_KEY_SET.has(c) : HL_KEY_SET.has(c);
}

/** Number of points in a stroke: the origin plus one per delta pair. */
export function pointCount(s: Pick<InkStroke, 'd'>): number {
  return 1 + s.d.length / 2;
}

/**
 * Checks what the schema can't: even delta count, integer steps within
 * maxStep, every decoded point inside the coordinate bounds (§6.2), and a
 * pressure array (if any) with exactly one integer 0..100 per point.
 * Returns a short problem code (never echoes data) or null.
 */
export function checkStroke(s: InkStroke): string | null {
  if (!colorAllowed(s.tool, s.c)) return 'color';
  if (s.d.length % 2 !== 0) return 'odd_deltas';
  let x = s.o[0];
  let y = s.o[1];
  for (let i = 0; i < s.d.length; i += 2) {
    const dx = s.d[i] as number;
    const dy = s.d[i + 1] as number;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) return 'non_integer';
    if (Math.abs(dx) > L.maxStep || Math.abs(dy) > L.maxStep) return 'step';
    x += dx;
    y += dy;
    if (x < L.minX || x > L.maxX || y < L.minY || y > L.maxY) return 'bounds';
  }
  if (s.p !== undefined) {
    if (s.p.length !== pointCount(s)) return 'pressure_length';
    for (const v of s.p) {
      if (!Number.isInteger(v) || v < 0 || v > L.maxPressure) return 'pressure_value';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Whole-layer validation
// ---------------------------------------------------------------------------

const invalid = () => new AppError('validation_failed', 'This drawing could not be opened because its data is damaged.');

export interface ValidateOptions {
  /** When set, the layer must belong to this note (a file for another note is rejected). */
  expectedNote?: string;
}

/**
 * Validates an already-parsed value. Also NORMALISES one harmless
 * inconsistency instead of rejecting: a stroke whose id is also tombstoned
 * is dropped (the tombstone wins, exactly as in a merge, §10.2).
 */
export function validateInkLayer(raw: unknown, opts: ValidateOptions = {}): Result<InkLayer> {
  const parsed = layerSchema.safeParse(raw);
  if (!parsed.success) return fail(invalid());
  const layer = parsed.data as InkLayer;
  if (opts.expectedNote !== undefined && layer.note !== opts.expectedNote) return fail(invalid());

  // Unique ids and per-stroke checks, with a running point total.
  const ids = new Set<string>();
  let points = 0;
  for (const s of layer.strokes) {
    if (ids.has(s.id)) return fail(invalid());
    ids.add(s.id);
    if (checkStroke(s) !== null) return fail(invalid());
    points += pointCount(s);
    if (points > L.maxTotalPoints) return fail(new AppError('too_large', 'This drawing is too large to open.'));
  }
  const goneIds = new Set<string>();
  for (const g of layer.gone) {
    if (goneIds.has(g.id)) return fail(invalid());
    goneIds.add(g.id);
  }

  // Normalise: tombstones win over live strokes with the same id.
  const strokes = layer.strokes.filter((s) => !goneIds.has(s.id));
  return ok({ ...layer, strokes });
}

/**
 * Parses an untrusted serialized layer. The size check comes BEFORE
 * JSON.parse, so an oversized file is rejected without being parsed.
 */
export function parseInkJson(json: string, opts: ValidateOptions = {}): Result<InkLayer> {
  if (json.length > L.maxFileBytes || utf8Length(json) > L.maxFileBytes) {
    return fail(new AppError('too_large', 'This drawing is too large to open.'));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fail(invalid());
  }
  return validateInkLayer(raw, opts);
}

/** An empty layer for a note. */
export function emptyInkLayer(noteId: string): InkLayer {
  return { kind: INK_FORMAT_KIND, v: INK_FORMAT_VERSION, note: noteId, unit: INK_UNIT, strokes: [], gone: [] };
}

/**
 * Serializes a layer with a FIXED key order, so the same layer always gives
 * the same bytes (the service compares strings to skip unchanged publishes).
 * The output is ASCII-only: keys are fixed, ids and colours are ASCII by
 * their patterns and everything else is an integer (§6.3).
 */
export function serializeInk(layer: InkLayer): string {
  const strokes = layer.strokes.map((s) => {
    const out: Record<string, unknown> = { id: s.id, b: s.b, tool: s.tool, c: s.c, w: s.w, o: s.o, d: s.d };
    if (s.p !== undefined) out.p = s.p;
    out.t = s.t;
    if (s.rec !== undefined) out.rec = { r: s.rec.r, ms: s.rec.ms };
    return out;
  });
  return JSON.stringify({
    kind: layer.kind,
    v: layer.v,
    note: layer.note,
    unit: layer.unit,
    strokes,
    gone: layer.gone.map((g) => ({ id: g.id, t: g.t })),
  });
}

/** Share of the tightest cap used (0..1+). The UI warns at INK_LIMITS.warnRatio. */
export function inkUsage(layer: InkLayer, serializedLength?: number): number {
  let points = 0;
  for (const s of layer.strokes) points += pointCount(s);
  const bytes = serializedLength ?? serializeInk(layer).length;
  return Math.max(layer.strokes.length / L.maxStrokes, points / L.maxTotalPoints, bytes / L.maxFileBytes);
}
