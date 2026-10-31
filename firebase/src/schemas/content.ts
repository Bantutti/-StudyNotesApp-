/**
 * content.ts — zod schemas for what lives INSIDE the capped JSON strings
 * (note document, recording segments, pack/template definitions, settings).
 *
 * Firestore rules cannot parse JSON, so everything here is a "schema check on
 * load" (Plan v0.2 §17, "Cards and review logs: schema checks on load"). The
 * sync module must run these before trusting cloud data.
 *
 * SCOPE NOTE: the editor (P1) owns the full block schema. This file checks only
 * the cloud-boundary invariants the backend relies on:
 *   - the document is a ProseMirror-style tree rooted at { type: 'doc' }
 *   - every top-level block has a stable, unique block id (plan §12)
 *   - optional audio anchors have the plan's shape (recording id, start ms, end ms)
 *   - depth and node count are bounded (stops "JSON bomb" style payloads)
 * See docs/backend/DATA_MODEL.md §D.4.
 */
import { z } from 'zod';
import { BLOCK_ID_PATTERN, ENTITY_ID_PATTERN, INTS, JSON_INNER } from './limits.js';

/** True for {} style objects (not arrays, not null). JSON.parse never yields class instances. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Generic depth meter for arbitrary JSON (used by definition/settings). Iterative: no stack overflow. */
function jsonDepth(root: unknown): number {
  let max = 0;
  const stack: Array<{ v: unknown; d: number }> = [{ v: root, d: 1 }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { v, d } = item;
    if (typeof v !== 'object' || v === null) continue;
    max = Math.max(max, d);
    for (const child of Array.isArray(v) ? (v as unknown[]) : Object.values(v)) stack.push({ v: child, d: d + 1 });
  }
  return max;
}

/** Audio anchor on a block: links a line to a moment in a recording (plan §12, F11). */
export const audioAnchorSchema = z
  .strictObject({
    recordingId: z.string().regex(ENTITY_ID_PATTERN),
    startMs: z.int().min(0).max(INTS.durationMaxMs),
    endMs: z.int().min(0).max(INTS.durationMaxMs),
  })
  .refine((a) => a.endMs >= a.startMs, { message: 'endMs must be >= startMs' });

const NODE_KEYS = new Set(['type', 'attrs', 'content', 'text', 'marks']);
const NODE_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** A problem found in a note document: message plus where it is. */
export interface DocumentProblem {
  message: string;
  path: (string | number)[];
}

/** Checks one node's own shape (not its children). Returns a message or null. */
function nodeShapeProblem(node: unknown): string | null {
  if (!isPlainObject(node)) return 'Node must be an object';
  for (const k of Object.keys(node)) if (!NODE_KEYS.has(k)) return `Unknown node key "${k}"`;
  if (typeof node.type !== 'string' || !NODE_TYPE_PATTERN.test(node.type)) return 'Bad node type';
  if (node.text !== undefined && typeof node.text !== 'string') return 'text must be a string';
  if (node.attrs !== undefined && !isPlainObject(node.attrs)) return 'attrs must be an object';
  if (node.content !== undefined && !Array.isArray(node.content)) return 'content must be an array';
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) return 'marks must be an array';
    for (const m of node.marks as unknown[]) {
      if (!isPlainObject(m) || typeof m.type !== 'string' || !NODE_TYPE_PATTERN.test(m.type)) return 'Bad mark';
      if (m.attrs !== undefined && !isPlainObject(m.attrs)) return 'Mark attrs must be an object';
    }
  }
  return null;
}

/**
 * Walks a note document and returns the FIRST problem, or null when valid.
 * One iterative pass (no recursion) so a 50k-node document can't blow the JS
 * stack, and so depth and node count are measured in the same pass.
 * Sections refer to docs/backend/DATA_MODEL.md.
 */
export function findDocumentProblem(root: unknown): DocumentProblem | null {
  // §D.4.1 — root must be { type: 'doc', content: [...] }.
  if (!isPlainObject(root) || root.type !== 'doc' || !Array.isArray(root.content)) {
    return { message: "Document root must be { type: 'doc', content: [] }", path: [] };
  }

  const seenIds = new Set<string>();
  let nodes = 0;
  type Entry = { node: unknown; depth: number; topLevel: boolean; path: (string | number)[] };
  const stack: Entry[] = [{ node: root, depth: 1, topLevel: false, path: [] }];

  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, depth, topLevel, path } = item;
    nodes += 1;
    // §D.4.2 — bounds first, so a hostile payload stops early.
    if (nodes > JSON_INNER.documentMaxNodes) return { message: `More than ${JSON_INNER.documentMaxNodes} nodes`, path };
    if (depth > JSON_INNER.documentMaxDepth) return { message: `Deeper than ${JSON_INNER.documentMaxDepth} levels`, path };

    const shape = nodeShapeProblem(node);
    if (shape !== null) return { message: shape, path };
    const n = node as Record<string, unknown>; // safe: nodeShapeProblem checked it is a plain object

    // §D.4.3 — block ids: required on top-level blocks, optional deeper, unique everywhere.
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    const id = attrs.id;
    if (topLevel && id === undefined) return { message: 'Top-level block needs attrs.id', path };
    if (id !== undefined && id !== null) {
      if (typeof id !== 'string' || !BLOCK_ID_PATTERN.test(id)) return { message: 'Bad block id', path };
      if (seenIds.has(id)) return { message: `Duplicate block id "${id}"`, path };
      seenIds.add(id);
    }

    // §D.4.4 — audio anchor shape (null means "no anchor").
    if (attrs.audioAnchor !== undefined && attrs.audioAnchor !== null && !audioAnchorSchema.safeParse(attrs.audioAnchor).success) {
      return { message: 'Bad audioAnchor', path };
    }

    if (Array.isArray(n.content)) {
      (n.content as unknown[]).forEach((child, i) => {
        stack.push({ node: child, depth: depth + 1, topLevel: depth === 1, path: [...path, 'content', i] });
      });
    }
  }
  return null;
}

/** zod wrapper so the note schema can use the walker inside jsonString(). */
export const noteDocumentSchema = z.unknown().superRefine((root, ctx) => {
  const problem = findDocumentProblem(root);
  if (problem) ctx.addIssue({ code: 'custom', message: problem.message, path: problem.path });
});

/** One transcript segment (plan §12: start, end, text; plan §14: segment ids). Times in ms. */
export const segmentSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
    start: z.int().min(0).max(INTS.durationMaxMs),
    end: z.int().min(0).max(INTS.durationMaxMs),
    text: z.string().max(JSON_INNER.segmentTextMax),
  })
  .refine((s) => s.end >= s.start, { message: 'end must be >= start' });

export const segmentsSchema = z
  .array(segmentSchema)
  .max(JSON_INNER.segmentsMaxCount)
  .refine((a) => new Set(a.map((s) => s.id)).size === a.length, { message: 'Segment ids must be unique' });

/**
 * Pack / template definition: only the outer shape is checked here. The real
 * validator is the style-pack schema v3 checker (validate.js, stylepacks module),
 * which MUST also run on load. See MERGE_NOTES.
 */
export const definitionSchema = z
  .unknown()
  .refine(isPlainObject, { message: 'Definition must be a JSON object' })
  .refine((v) => jsonDepth(v) <= JSON_INNER.definitionMaxDepth, { message: 'Definition too deep' });

/** User settings: a small JSON object. Keys are owned by P1/P2 app code. */
export const settingsSchema = z
  .unknown()
  .refine(isPlainObject, { message: 'Settings must be a JSON object' })
  .refine((v) => jsonDepth(v) <= JSON_INNER.settingsMaxDepth, { message: 'Settings too deep' });
