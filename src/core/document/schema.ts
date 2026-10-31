/**
 * Note document model (ProseMirror / TipTap JSON) with stable block ids.
 *
 * This schema is the trust boundary for every document that crosses into
 * the app: from the editor WebView, from storage, and later from sync and
 * AI. It allows only known node and mark types, strips unknown attributes,
 * restricts link protocols, and enforces size and depth limits.
 */
import * as z from 'zod';

export const DOC_LIMITS = {
  maxJsonBytes: 2_000_000,
  maxDepth: 16,
  maxNodes: 50_000,
  maxTextLength: 20_000,
  maxTermLength: 200,
  maxHrefLength: 2_000,
} as const;

/** Block ids look like "b_" + 10..32 url-safe chars. */
export const BLOCK_ID = /^b_[A-Za-z0-9]{10,32}$/;
export const HIGHLIGHT_KEYS = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5'] as const;
export type HighlightKey = (typeof HIGHLIGHT_KEYS)[number];

/** Node types that are "blocks" and therefore carry a stable id. */
export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'callout',
  'definition',
  'horizontalRule',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

const blockId = z.string().regex(BLOCK_ID).nullable().optional();

const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  z.object({ type: z.literal('underline') }),
  z.object({ type: z.literal('strike') }),
  z.object({
    type: z.literal('highlight'),
    attrs: z.object({ key: z.enum(HIGHLIGHT_KEYS) }),
  }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({
      href: z
        .string()
        .max(DOC_LIMITS.maxHrefLength)
        .regex(/^(https?:\/\/|mailto:)/i, 'unsupported link protocol'),
    }),
  }),
]);
export type Mark = z.infer<typeof markSchema>;

export type DocNode =
  | { type: 'text'; text: string; marks?: Mark[] }
  | { type: 'hardBreak' }
  | { type: 'paragraph'; attrs?: { blockId?: string | null }; content?: DocNode[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3; blockId?: string | null }; content?: DocNode[] }
  | { type: 'bulletList'; attrs?: { blockId?: string | null }; content: DocNode[] }
  | { type: 'orderedList'; attrs?: { start?: number; blockId?: string | null }; content: DocNode[] }
  | { type: 'listItem'; attrs?: { blockId?: string | null }; content: DocNode[] }
  | { type: 'callout'; attrs?: { blockId?: string | null }; content: DocNode[] }
  | { type: 'definition'; attrs: { term: string; blockId?: string | null }; content: DocNode[] }
  | { type: 'horizontalRule'; attrs?: { blockId?: string | null } };

export interface NoteDoc {
  type: 'doc';
  content: DocNode[];
}

const children = (): z.ZodType<DocNode[]> => z.array(z.lazy(() => nodeSchema));

const nodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      text: z.string().min(1).max(DOC_LIMITS.maxTextLength),
      marks: z.array(markSchema).max(8).optional(),
    }),
    z.object({ type: z.literal('hardBreak') }),
    z.object({
      type: z.literal('paragraph'),
      attrs: z.object({ blockId }).optional(),
      content: children().optional(),
    }),
    z.object({
      type: z.literal('heading'),
      attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]), blockId }),
      content: children().optional(),
    }),
    z.object({
      type: z.literal('bulletList'),
      attrs: z.object({ blockId }).optional(),
      content: children(),
    }),
    z.object({
      type: z.literal('orderedList'),
      attrs: z.object({ start: z.number().int().min(0).max(10_000).optional(), blockId }).optional(),
      content: children(),
    }),
    z.object({
      type: z.literal('listItem'),
      attrs: z.object({ blockId }).optional(),
      content: children(),
    }),
    z.object({
      type: z.literal('callout'),
      attrs: z.object({ blockId }).optional(),
      content: children(),
    }),
    z.object({
      type: z.literal('definition'),
      attrs: z.object({ term: z.string().max(DOC_LIMITS.maxTermLength), blockId }),
      content: children(),
    }),
    z.object({
      type: z.literal('horizontalRule'),
      attrs: z.object({ blockId }).optional(),
    }),
  ]),
) as z.ZodType<DocNode>;

export const noteDocSchema: z.ZodType<NoteDoc> = z.object({
  type: z.literal('doc'),
  content: children(),
});

/** Depth and node-count limits (zod alone cannot express these cheaply). */
export function checkDocLimits(doc: NoteDoc): { ok: true } | { ok: false; reason: 'depth' | 'nodes' } {
  let count = 0;
  const stack: { nodes: readonly DocNode[]; depth: number }[] = [{ nodes: doc.content, depth: 1 }];
  while (stack.length) {
    const { nodes, depth } = stack.pop() as { nodes: readonly DocNode[]; depth: number };
    if (depth > DOC_LIMITS.maxDepth) return { ok: false, reason: 'depth' };
    for (const n of nodes) {
      count++;
      if (count > DOC_LIMITS.maxNodes) return { ok: false, reason: 'nodes' };
      if ('content' in n && n.content) stack.push({ nodes: n.content, depth: depth + 1 });
    }
  }
  return { ok: true };
}
