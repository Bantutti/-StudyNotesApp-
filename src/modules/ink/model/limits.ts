/**
 * Ink limits (P4b). Every number here is a hard cap that the loader enforces
 * on files from disk, from sync and from the editor bridge, so a hostile or
 * damaged ink file can never make the app allocate or render without bound.
 *
 * Units (docs/modules/INK_MATH.md §1): stroke coordinates are integers in
 * "block units", where 1000 units = the width of the stroke's anchor block.
 * Widths are stored in tenths of a unit.
 */

export const INK_FORMAT_KIND = 'notedpo-ink' as const;
export const INK_FORMAT_VERSION = 1 as const;

/** 1000 units = the anchor block's width (§1.1). */
export const INK_UNIT = 1000 as const;

export const INK_LIMITS = {
  /**
   * File size cap in bytes (and characters: the format is ASCII-only, §6.3).
   * The cloud allows 5 MiB per ink file (P2a STORAGE.ink.maxBytes); 4 MiB
   * leaves headroom so a full local file can always be uploaded.
   */
  maxFileBytes: 4 * 1024 * 1024,
  /** Strokes per note. */
  maxStrokes: 10_000,
  /** Points per stroke. Longer strokes are split while drawing (see layer.ts). */
  maxPointsPerStroke: 2_000,
  /** Points across the whole note. */
  maxTotalPoints: 400_000,
  /** Deletion tombstones kept for merging (oldest are compacted first, §10.3). */
  maxTombstones: 5_000,
  /** Show "drawing is nearly full" at this share of any cap. */
  warnRatio: 0.9,

  /** Coordinate bounds in units (x: a block width either side; y: tall margins allowed). */
  minX: -1_000,
  maxX: 2_000,
  minY: -50_000,
  maxY: 50_000,
  /** Largest single delta step in units (a jump bigger than this is not a real pen move). */
  maxStep: 4_000,

  /** Width in tenths of a unit (0.5 .. 40 units). */
  minWidth: 5,
  maxWidth: 400,
  /** Pressure is stored 0..100 (integer percent). */
  maxPressure: 100,

  /** Timestamps (ms since 1970): 0 .. year 2100. */
  maxTime: 4_102_444_800_000,
  /** Recording anchor offset: 0 .. 6 h, the same as P2a INTS.durationMaxMs. */
  maxRecordingMs: 21_600_000,

  /** Undo steps kept per note visit. */
  maxHistory: 100,
} as const;

/** Stroke ids: "s_" + 16..32 [A-Za-z0-9] (IdGenerator.newId('s') makes 16). */
export const STROKE_ID = /^s_[A-Za-z0-9]{16,32}$/;

/** Pack colour keys: three pens and the highlighter (restyle with the pack, decision Q7). */
export const PEN_KEYS = ['p0', 'p1', 'p2'] as const;
export const HIGHLIGHTER_KEYS = ['h0'] as const;
export type PenKey = (typeof PEN_KEYS)[number];
export type HighlighterKey = (typeof HIGHLIGHTER_KEYS)[number];

/** A custom colour: "#RRGGBB", upper case (normalised before saving). */
export const HEX_COLOR = /^#[0-9A-F]{6}$/;
