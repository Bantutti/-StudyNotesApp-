/**
 * Note document model v2 (ProseMirror / TipTap JSON) with stable block ids.
 *
 * This schema is the trust boundary for every document that crosses into
 * the app: from the editor WebView, from storage, and later from sync and
 * AI. It allows only known node and mark types, strips unknown attributes,
 * restricts link protocols, and enforces size, depth and structure limits.
 *
 * v2 (P1) adds: blockquote, summary, Q&A (qa > qaQuestion + qaAnswer),
 * two columns (columns > column x2, layout even or cornell), simple tables
 * (table > tableRow > tableHeader | tableCell, no merged cells), and an
 * optional audioAnchor on every block (P2a's shape, used from P4).
 * v1 documents are valid v2 documents (no migration needed).
 */
import * as z from 'zod';

import { DOCUMENT_LIMITS, ENTITY_ID_PATTERN } from '../limits';

export const DOC_LIMITS = {
  /** Same as the cloud's byte cap (P2a §L.6.1), so a stored note can always sync. */
  maxJsonBytes: DOCUMENT_LIMITS.maxBytes,
  maxDepth: 16,
  maxNodes: 50_000,
  maxTextLength: 20_000,
  maxTermLength: 200,
  maxHrefLength: 2_000,
  maxTableRows: 200,
  maxTableCols: 12,
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
  'blockquote',
  'summary',
  'qa',
  'qaQuestion',
  'qaAnswer',
  'columns',
  'column',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const COLUMN_LAYOUTS = ['even', 'cornell'] as const;
export type ColumnLayout = (typeof COLUMN_LAYOUTS)[number];

/** Links a block to a moment in a recording (P2a audioAnchorSchema, plan F11). */
// Type aliases (not interfaces) on purpose: aliases stay assignable to
// Record<string, unknown>, which code walking attrs generically relies on.
export type AudioAnchor = {
  recordingId: string;
  startMs: number;
  endMs: number;
};

const MAX_MS = 21_600_000; // 6 h, P2a INTS.durationMaxMs
export const audioAnchorSchema = z
  .object({
    recordingId: z.string().regex(ENTITY_ID_PATTERN),
    startMs: z.number().int().min(0).max(MAX_MS),
    endMs: z.number().int().min(0).max(MAX_MS),
  })
  .refine((a) => a.endMs >= a.startMs, 'endMs must be >= startMs');

/** Attributes every block may carry. */
export type BlockAttrs = {
  blockId?: string | null;
  audioAnchor?: AudioAnchor | null;
};

const blockAttrShape = {
  blockId: z.string().regex(BLOCK_ID).nullable().optional(),
  audioAnchor: audioAnchorSchema.nullable().optional(),
};

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

export type TableCellAttrs = BlockAttrs & {
  /** Merged cells are not supported in P1: always 1 when present. */
  colspan?: 1;
  rowspan?: 1;
  colwidth?: number[] | null;
};

export type DocNode =
  | { type: 'text'; text: string; marks?: Mark[] }
  | { type: 'hardBreak' }
  | { type: 'paragraph'; attrs?: BlockAttrs; content?: DocNode[] }
  | { type: 'heading'; attrs: BlockAttrs & { level: 1 | 2 | 3 }; content?: DocNode[] }
  | { type: 'bulletList'; attrs?: BlockAttrs; content: DocNode[] }
  | { type: 'orderedList'; attrs?: BlockAttrs & { start?: number }; content: DocNode[] }
  | { type: 'listItem'; attrs?: BlockAttrs; content: DocNode[] }
  | { type: 'callout'; attrs?: BlockAttrs; content: DocNode[] }
  | { type: 'definition'; attrs: BlockAttrs & { term: string }; content: DocNode[] }
  | { type: 'horizontalRule'; attrs?: BlockAttrs }
  | { type: 'blockquote'; attrs?: BlockAttrs; content: DocNode[] }
  | { type: 'summary'; attrs?: BlockAttrs; content: DocNode[] }
  | { type: 'qa'; attrs?: BlockAttrs; content: DocNode[] }
  | { type: 'qaQuestion'; attrs?: BlockAttrs; content?: DocNode[] }
  | { type: 'qaAnswer'; attrs?: BlockAttrs; content: DocNode[] }
  | { type: 'columns'; attrs?: BlockAttrs & { layout?: ColumnLayout }; content: DocNode[] }
  | { type: 'column'; attrs?: BlockAttrs; content: DocNode[] }
  | { type: 'table'; attrs?: BlockAttrs; content: DocNode[] }
  | { type: 'tableRow'; attrs?: BlockAttrs; content: DocNode[] }
  | { type: 'tableHeader'; attrs?: TableCellAttrs; content: DocNode[] }
  | { type: 'tableCell'; attrs?: TableCellAttrs; content: DocNode[] };

export interface NoteDoc {
  type: 'doc';
  content: DocNode[];
}

const children = (): z.ZodType<DocNode[]> => z.array(z.lazy(() => nodeSchema));
const attrs = (extra: z.ZodRawShape = {}) => z.object({ ...blockAttrShape, ...extra });
const cellAttrs = attrs({
  colspan: z.literal(1).optional(),
  rowspan: z.literal(1).optional(),
  colwidth: z.array(z.number().int().min(20).max(2000)).max(1).nullable().optional(),
});

const nodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      text: z.string().min(1).max(DOC_LIMITS.maxTextLength),
      marks: z.array(markSchema).max(8).optional(),
    }),
    z.object({ type: z.literal('hardBreak') }),
    z.object({ type: z.literal('paragraph'), attrs: attrs().optional(), content: children().optional() }),
    z.object({
      type: z.literal('heading'),
      attrs: attrs({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
      content: children().optional(),
    }),
    z.object({ type: z.literal('bulletList'), attrs: attrs().optional(), content: children() }),
    z.object({
      type: z.literal('orderedList'),
      attrs: attrs({ start: z.number().int().min(0).max(10_000).optional() }).optional(),
      content: children(),
    }),
    z.object({ type: z.literal('listItem'), attrs: attrs().optional(), content: children() }),
    z.object({ type: z.literal('callout'), attrs: attrs().optional(), content: children() }),
    z.object({
      type: z.literal('definition'),
      attrs: attrs({ term: z.string().max(DOC_LIMITS.maxTermLength) }),
      content: children(),
    }),
    z.object({ type: z.literal('horizontalRule'), attrs: attrs().optional() }),
    z.object({ type: z.literal('blockquote'), attrs: attrs().optional(), content: children() }),
    z.object({ type: z.literal('summary'), attrs: attrs().optional(), content: children() }),
    z.object({ type: z.literal('qa'), attrs: attrs().optional(), content: children() }),
    z.object({ type: z.literal('qaQuestion'), attrs: attrs().optional(), content: children().optional() }),
    z.object({ type: z.literal('qaAnswer'), attrs: attrs().optional(), content: children() }),
    z.object({
      type: z.literal('columns'),
      attrs: attrs({ layout: z.enum(COLUMN_LAYOUTS).optional() }).optional(),
      content: children(),
    }),
    z.object({ type: z.literal('column'), attrs: attrs().optional(), content: children() }),
    z.object({ type: z.literal('table'), attrs: attrs().optional(), content: children() }),
    z.object({ type: z.literal('tableRow'), attrs: attrs().optional(), content: children() }),
    z.object({ type: z.literal('tableHeader'), attrs: cellAttrs.optional(), content: children() }),
    z.object({ type: z.literal('tableCell'), attrs: cellAttrs.optional(), content: children() }),
  ]),
) as z.ZodType<DocNode>;

export const noteDocSchema: z.ZodType<NoteDoc> = z.object({
  type: z.literal('doc'),
  content: children(),
});

// ---------------------------------------------------------------------------
// Structure rules (what may contain what). zod checks each node's shape; this
// checks nesting, mirroring the editor's ProseMirror content expressions, so
// a document from storage, sync or AI can't hold shapes the editor can't.
// ---------------------------------------------------------------------------

const INLINE = new Set(['text', 'hardBreak']);
/** Blocks allowed directly in the doc, a column, a callout and similar containers. */
const FLOW = new Set([
  'paragraph', 'heading', 'bulletList', 'orderedList', 'callout', 'definition', 'horizontalRule',
  'blockquote', 'summary', 'qa', 'columns', 'table',
]);
const without = (s: Set<string>, ...drop: string[]) => new Set([...s].filter((x) => !drop.includes(x)));
/** Inside a column: no nested columns. */
const COLUMN_FLOW = without(FLOW, 'columns');
/** Inside study boxes, quotes, answers and list items: simple blocks only. */
const SIMPLE = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'horizontalRule']);

type Rule =
  | { kind: 'inline' }
  | { kind: 'leaf' }
  | { kind: 'blocks'; allowed: Set<string>; min: number }
  | { kind: 'exact'; sequence: string[] }
  | { kind: 'rows' }
  | { kind: 'cells' };

const RULES: Record<string, Rule> = {
  paragraph: { kind: 'inline' },
  heading: { kind: 'inline' },
  qaQuestion: { kind: 'inline' },
  horizontalRule: { kind: 'leaf' },
  bulletList: { kind: 'blocks', allowed: new Set(['listItem']), min: 1 },
  orderedList: { kind: 'blocks', allowed: new Set(['listItem']), min: 1 },
  listItem: { kind: 'blocks', allowed: SIMPLE, min: 1 },
  callout: { kind: 'blocks', allowed: SIMPLE, min: 1 },
  definition: { kind: 'blocks', allowed: SIMPLE, min: 1 },
  blockquote: { kind: 'blocks', allowed: SIMPLE, min: 1 },
  summary: { kind: 'blocks', allowed: SIMPLE, min: 1 },
  qaAnswer: { kind: 'blocks', allowed: SIMPLE, min: 1 },
  qa: { kind: 'exact', sequence: ['qaQuestion', 'qaAnswer'] },
  columns: { kind: 'exact', sequence: ['column', 'column'] },
  column: { kind: 'blocks', allowed: COLUMN_FLOW, min: 1 },
  table: { kind: 'rows' },
  tableRow: { kind: 'cells' },
  tableHeader: { kind: 'blocks', allowed: new Set(['paragraph']), min: 1 },
  tableCell: { kind: 'blocks', allowed: new Set(['paragraph']), min: 1 },
};

export type StructureProblem = 'nesting' | 'table_shape';

function kidsOf(n: DocNode): readonly DocNode[] {
  return 'content' in n && n.content ? n.content : [];
}

/** Returns the first structure problem, or null. Iterative (no recursion). */
export function checkDocStructure(doc: NoteDoc): StructureProblem | null {
  for (const n of doc.content) if (!FLOW.has(n.type)) return 'nesting';
  const stack: DocNode[] = [...doc.content];
  while (stack.length) {
    const n = stack.pop() as DocNode;
    const rule = RULES[n.type];
    if (!rule) continue; // text, hardBreak
    const kids = kidsOf(n);
    switch (rule.kind) {
      case 'inline':
        if (kids.some((k) => !INLINE.has(k.type))) return 'nesting';
        break;
      case 'leaf':
        break;
      case 'blocks':
        if (kids.length < rule.min || kids.some((k) => !rule.allowed.has(k.type))) return 'nesting';
        break;
      case 'exact':
        if (kids.length !== rule.sequence.length || kids.some((k, i) => k.type !== rule.sequence[i])) return 'nesting';
        break;
      case 'rows': {
        if (kids.length < 1 || kids.length > DOC_LIMITS.maxTableRows || kids.some((k) => k.type !== 'tableRow')) {
          return 'table_shape';
        }
        const width = kidsOf(kids[0] as DocNode).length;
        if (kids.some((r) => kidsOf(r).length !== width)) return 'table_shape';
        break;
      }
      case 'cells':
        if (
          kids.length < 1 ||
          kids.length > DOC_LIMITS.maxTableCols ||
          kids.some((k) => k.type !== 'tableCell' && k.type !== 'tableHeader')
        ) {
          return 'table_shape';
        }
        break;
    }
    for (const k of kids) stack.push(k);
  }
  return null;
}

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
