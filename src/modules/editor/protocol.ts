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
]);
export type ToWeb = z.infer<typeof toWebSchema>;

export const METRICS = ['boot_ms', 'load_ms', 'set_pack_ms', 'set_fonts_ms'] as const;
export const ERROR_CODES = ['invalid_message', 'invalid_doc', 'invalid_pack', 'invalid_fonts', 'too_large', 'internal'] as const;

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
