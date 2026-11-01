import type { IdGenerator } from '../ids';
import { BLOCK_ID, BLOCK_TYPES, type DocNode, type NoteDoc } from './schema';

const isBlock = (t: string): boolean => (BLOCK_TYPES as readonly string[]).includes(t);

/**
 * The attribute that holds a block's stable id. Decided in P1 (Rey, Nov 1):
 * `attrs.blockId`, matching cards' `sourceBlockId` and the editor's
 * `data-block-id`. P2a's cloud schema reads the same attribute.
 * Code outside core should use getBlockId() instead of reading attrs.
 */
export const BLOCK_ID_ATTR = 'blockId' as const;

/** Returns a node's block id, or null when it has none (or it is malformed). */
export function getBlockId(node: unknown): string | null {
  if (typeof node !== 'object' || node === null) return null;
  const attrs = (node as { attrs?: unknown }).attrs;
  if (typeof attrs !== 'object' || attrs === null) return null;
  const v = (attrs as Record<string, unknown>)[BLOCK_ID_ATTR];
  return typeof v === 'string' && BLOCK_ID.test(v) ? v : null;
}

/**
 * Returns a copy of the doc where every block has a unique, valid blockId.
 * Existing ids are kept (so cards, audio anchors and versions stay linked);
 * missing, malformed or duplicate ids are replaced. Pure function.
 */
export function ensureBlockIds(doc: NoteDoc, ids: IdGenerator): NoteDoc {
  const seen = new Set<string>();
  const visit = (node: DocNode): DocNode => {
    let next: DocNode = node;
    if (isBlock(node.type)) {
      const attrs = ('attrs' in node && node.attrs ? node.attrs : {}) as { blockId?: string | null };
      const current = attrs.blockId;
      const valid = typeof current === 'string' && BLOCK_ID.test(current) && !seen.has(current);
      const id = valid ? (current as string) : ids.newId('b');
      seen.add(id);
      next = { ...node, attrs: { ...attrs, blockId: id } } as DocNode;
    }
    if ('content' in next && next.content) {
      next = { ...next, content: next.content.map(visit) } as DocNode;
    }
    return next;
  };
  return { type: 'doc', content: doc.content.map(visit) };
}

/** Lists block ids in document order (used by anchors and diff tooling). */
export function listBlockIds(doc: NoteDoc): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly DocNode[]) => {
    for (const n of nodes) {
      if ('attrs' in n && n.attrs && 'blockId' in n.attrs && typeof n.attrs.blockId === 'string') {
        out.push(n.attrs.blockId);
      }
      if ('content' in n && n.content) walk(n.content);
    }
  };
  walk(doc.content);
  return out;
}

/** Counts top-level and nested blocks (for metrics only). */
export function countBlocks(doc: NoteDoc): number {
  return listBlockIds(doc).length;
}
