/**
 * Editor bridge protocol (React Native <-> WebView), shared by both sides.
 *
 * Rules:
 * - Every message is JSON with { v: 1, type }. Unknown types are rejected.
 * - Raw size is checked BEFORE JSON.parse (MAX_BRIDGE_CHARS).
 * - Documents and packs inside messages are validated again by their own
 *   schemas (validateNoteDoc / validatePack) at the receiving side.
 * - Only data crosses the bridge: never HTML, CSS or script.
 * - Typing diagnostics carry event METADATA only (types, lengths, flags),
 *   never typed text.
 * Web-safe: imports zod only.
 */
import * as z from 'zod';

export const PROTOCOL_VERSION = 1 as const;
/** Fonts are the largest payload (~4 faces x ~300 KB base64). */
export const MAX_BRIDGE_CHARS = 6_000_000;

export const COMMANDS = [
  // marks
  'bold', 'italic', 'underline', 'strike', 'highlight', 'unhighlight', 'link', 'unlink',
  // text blocks
  'h1', 'h2', 'h3', 'paragraph',
  // structure
  'bulletList', 'orderedList', 'callout', 'definition', 'hr', 'blockquote', 'summary', 'qa', 'columns', 'cornell', 'table',
  // tables
  'addRowAfter', 'addColumnAfter', 'deleteRow', 'deleteColumn', 'deleteTable',
  // block menu
  'duplicateBlock', 'moveBlockUp', 'moveBlockDown', 'deleteBlock',
  // history and UI
  'undo', 'redo', 'blockPicker', 'blur',
] as const;
export type EditorCommand = (typeof COMMANDS)[number];

/** Block kinds reported for toolbar state. */
export const BLOCK_KINDS = [
  'paragraph', 'heading1', 'heading2', 'heading3', 'bulletList', 'orderedList', 'callout', 'definition',
  'blockquote', 'summary', 'qa', 'columns', 'table', 'other',
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const MARK_NAMES = ['bold', 'italic', 'underline', 'strike', 'highlight', 'link'] as const;

const v = z.literal(PROTOCOL_VERSION);
const reqId = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const blockIdArg = z.string().regex(/^b_[A-Za-z0-9]{10,32}$/);

// ---------------------------------------------------------------------------
// Ink (P4b). Native turns each stroke into SVG path data in BLOCK UNITS
// (1000 = the anchor block's width; docs/modules/INK_MATH.md §1), so the page
// never parses ink files: it only places ready, checked paths over blocks.
// Path data is limited to the characters our own formatter emits
// (src/modules/ink geometry/svg.ts SAFE_PATH; a test keeps the two equal).
// ---------------------------------------------------------------------------
export const INK_PATH_CHARS = /^[MLQZ0-9 .-]*$/;
export const INK_MAX_PATH_CHARS = 200_000;
export const INK_MAX_ITEMS_PER_MESSAGE = 500;
export const INK_MAX_ITEMS = 10_000;
const strokeIdArg = z.string().regex(/^s_[A-Za-z0-9]{16,32}$/);

/** One stroke, ready to draw: path data in block units, a pack colour key or "#RRGGBB". */
export const inkItemSchema = z.strictObject({
  id: strokeIdArg,
  /** anchor block id */
  b: blockIdArg,
  /** 'under' = behind the text (highlighter), 'over' = on top (pen) */
  layer: z.enum(['under', 'over']),
  /** 'stroke' = constant-width centreline with round caps; 'fill' = variable-width outline */
  mode: z.enum(['stroke', 'fill']),
  /** line width in block units (stroke mode only; ignored for fill) */
  w: z.number().min(0).max(40),
  c: z.union([z.enum(['p0', 'p1', 'p2', 'h0']), z.string().regex(/^#[0-9A-F]{6}$/)]),
  d: z.string().max(INK_MAX_PATH_CHARS).regex(INK_PATH_CHARS),
});
export type InkItem = z.infer<typeof inkItemSchema>;

/** Keeps every inkAdd message well under MAX_BRIDGE_CHARS (paths dominate the size). */
export const INK_CHUNK_CHARS = 1_500_000;

/** Splits items into inkAdd-sized chunks: at most 500 items and about 1.5 M characters each. */
export function chunkInkItems(items: readonly InkItem[]): InkItem[][] {
  const out: InkItem[][] = [];
  let cur: InkItem[] = [];
  let chars = 0;
  for (const it of items) {
    const n = it.d.length + 160; // path + the other fields and JSON punctuation
    if (cur.length && (cur.length >= INK_MAX_ITEMS_PER_MESSAGE || chars + n > INK_CHUNK_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A block's box on the page, in CSS px relative to the page's top-left corner. */
export const inkBlockBoxSchema = z.strictObject({
  id: blockIdArg,
  depth: z.number().int().min(0).max(32),
  left: z.number().min(-100_000).max(100_000),
  top: z.number().min(-100_000).max(10_000_000),
  width: z.number().min(0).max(100_000),
  height: z.number().min(0).max(10_000_000),
});
export type InkBlockBox = z.infer<typeof inkBlockBoxSchema>;

/** React Native -> WebView */
export const toWebSchema = z.discriminatedUnion('type', [
  z.object({ v, type: z.literal('load'), doc: z.unknown() }),
  z.object({ v, type: z.literal('setPack'), pack: z.unknown() }),
  z.object({ v, type: z.literal('setFonts'), faces: z.array(z.unknown()).max(12) }),
  z.object({
    v,
    type: z.literal('command'),
    name: z.enum(COMMANDS),
    arg: z
      .union([z.enum(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']), z.string().max(2_000)])
      .optional(),
  }),
  z.object({ v, type: z.literal('requestDoc'), reqId }),
  z.object({ v, type: z.literal('requestSelection'), reqId }),
  z.object({ v, type: z.literal('ping'), reqId, sentAt: z.number() }),
  z.object({ v, type: z.literal('scrollToBlock'), blockId: blockIdArg }),
  z.object({ v, type: z.literal('setDiagnostics'), on: z.boolean() }),
  // ink (P4b)
  z.object({ v, type: z.literal('inkAdd'), items: z.array(inkItemSchema).max(INK_MAX_ITEMS_PER_MESSAGE) }),
  z.object({ v, type: z.literal('inkRemove'), ids: z.array(strokeIdArg).max(INK_MAX_ITEMS) }),
  z.object({ v, type: z.literal('inkClear') }),
  /** Draw mode on: the page pushes inkLayout after every layout change (batched per frame). */
  z.object({ v, type: z.literal('setInkFeed'), on: z.boolean() }),
  z.object({ v, type: z.literal('requestInkLayout'), reqId }),
]);
export type ToWeb = z.infer<typeof toWebSchema>;

export const METRICS = ['boot_ms', 'load_ms', 'set_pack_ms', 'set_fonts_ms'] as const;
export const ERROR_CODES = ['invalid_message', 'invalid_doc', 'invalid_pack', 'invalid_fonts', 'invalid_ink', 'too_large', 'internal'] as const;

export const DIAG_KINDS = [
  'compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown', 'selection', 'transaction',
] as const;

/** One typing-diagnostics event. Metadata only: no characters ever cross. */
export const diagEventSchema = z.strictObject({
  /** ms since the editor booted */
  t: z.number().min(0).max(86_400_000),
  kind: z.enum(DIAG_KINDS),
  /** e.g. insertText, insertCompositionText, deleteContentBackward */
  inputType: z.string().regex(/^[a-zA-Z]{0,40}$/).optional(),
  /** length of the event's data, not the data */
  len: z.number().int().min(0).max(100_000).optional(),
  composing: z.boolean().optional(),
  /** named keys only ("Enter", "Backspace", "Unidentified"); printable keys become "char" */
  key: z.string().regex(/^[A-Za-z]{2,20}$/).optional(),
  keyCode: z.number().int().min(0).max(1_000).optional(),
  /** cursor offset in its block, and the block's text length */
  offset: z.number().int().min(0).max(100_000).optional(),
  size: z.number().int().min(0).max(100_000).optional(),
});
export type DiagEvent = z.infer<typeof diagEventSchema>;

/** WebView -> React Native */
export const toNativeSchema = z.discriminatedUnion('type', [
  z.object({ v, type: z.literal('ready') }),
  z.object({
    v,
    type: z.literal('doc'),
    reqId: reqId.nullable(),
    reason: z.enum(['change', 'request']),
    doc: z.unknown(),
  }),
  z.object({ v, type: z.literal('pong'), reqId, sentAt: z.number() }),
  z.object({ v, type: z.literal('metric'), name: z.enum(METRICS), ms: z.number().min(0).max(600_000) }),
  /** reqId is set when the error answers a request (requestDoc): native rejects that request. */
  z.object({ v, type: z.literal('error'), code: z.enum(ERROR_CODES), reqId: reqId.nullable().optional() }),
  /** A link was tapped. Native re-validates and opens it OUTSIDE the app (links.ts). */
  z.object({ v, type: z.literal('openLink'), href: z.string().max(2_000) }),
  /** Answer to requestSelection: block ids touched by the selection, top-level first. */
  z.object({ v, type: z.literal('selection'), reqId, blockIds: z.array(blockIdArg).max(5_000) }),
  /** Toolbar state at the cursor (debounced). */
  z.object({
    v,
    type: z.literal('state'),
    block: z.enum(BLOCK_KINDS),
    marks: z.array(z.enum(MARK_NAMES)).max(6),
    inTable: z.boolean(),
    canUndo: z.boolean(),
    canRedo: z.boolean(),
  }),
  z.object({ v, type: z.literal('diag'), events: z.array(diagEventSchema).max(50) }),
  /**
   * Ink layout (P4b): where blocks are, so native can anchor new strokes.
   * originX/Y = the page's top-left corner in WebView viewport px (it moves
   * when the page scrolls); block boxes are page px. reqId null = pushed by
   * the feed.
   */
  z.object({
    v,
    type: z.literal('inkLayout'),
    reqId: reqId.nullable(),
    originX: z.number().min(-10_000_000).max(10_000_000),
    originY: z.number().min(-10_000_000).max(10_000_000),
    viewportWidth: z.number().min(0).max(100_000),
    viewportHeight: z.number().min(0).max(100_000),
    pageWidth: z.number().min(0).max(100_000),
    blocks: z.array(inkBlockBoxSchema).max(5_000),
  }),
  /** Strokes from the last inkAdd are drawn (native can drop its live copy). */
  z.object({ v, type: z.literal('inkAck'), ids: z.array(strokeIdArg).max(INK_MAX_ITEMS_PER_MESSAGE) }),
]);
export type ToNative = z.infer<typeof toNativeSchema>;

export type DecodeResult<T> = { ok: true; msg: T } | { ok: false; reason: 'too_large' | 'not_json' | 'invalid' };

export function decode<S extends z.ZodType>(raw: unknown, schema: S): DecodeResult<z.infer<S>> {
  if (typeof raw !== 'string') return { ok: false, reason: 'invalid' };
  if (raw.length > MAX_BRIDGE_CHARS) return { ok: false, reason: 'too_large' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  const parsed = schema.safeParse(data);
  return parsed.success ? { ok: true, msg: parsed.data } : { ok: false, reason: 'invalid' };
}

export function encode(msg: ToWeb | ToNative): string {
  return JSON.stringify(msg);
}
