/**
 * Editor bridge protocol (React Native <-> WebView), shared by both sides.
 *
 * Rules:
 * - Every message is JSON with { v: 1, type }. Unknown types are rejected.
 * - Raw size is checked BEFORE JSON.parse (MAX_BRIDGE_CHARS).
 * - Documents and packs inside messages are validated again by their own
 *   schemas (validateNoteDoc / validatePack) at the receiving side.
 * - Only data crosses the bridge: never HTML, CSS or script.
 * Web-safe: imports zod only.
 */
import * as z from 'zod';

export const PROTOCOL_VERSION = 1 as const;
/** Fonts are the largest payload (~4 faces x ~300 KB base64). */
export const MAX_BRIDGE_CHARS = 6_000_000;

export const COMMANDS = [
  'bold', 'italic', 'underline', 'strike',
  'h1', 'h2', 'h3', 'paragraph',
  'bulletList', 'orderedList', 'callout', 'definition', 'hr',
  'highlight', 'unhighlight', 'undo', 'redo',
] as const;
export type EditorCommand = (typeof COMMANDS)[number];

const v = z.literal(PROTOCOL_VERSION);
const reqId = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

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
      .union([z.enum(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']), z.string().max(200)])
      .optional(),
  }),
  z.object({ v, type: z.literal('requestDoc'), reqId }),
  z.object({ v, type: z.literal('ping'), reqId, sentAt: z.number() }),
]);
export type ToWeb = z.infer<typeof toWebSchema>;

export const METRICS = ['boot_ms', 'load_ms', 'set_pack_ms', 'set_fonts_ms'] as const;
export const ERROR_CODES = ['invalid_message', 'invalid_doc', 'invalid_pack', 'invalid_fonts', 'too_large', 'internal'] as const;

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
  z.object({ v, type: z.literal('error'), code: z.enum(ERROR_CODES) }),
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
