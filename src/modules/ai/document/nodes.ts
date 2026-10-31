/**
 * Small, name-agnostic helpers over core's document model.
 *
 * Block-id attribute name: P0 core stores the id in attrs.blockId; P2a's
 * cloud check reads attrs.id; P1 is choosing one. This module NEVER reads or
 * writes the id attribute by name. It uses core's listBlockIds() to read ids
 * and core's ensureBlockIds() to assign them, so it follows whatever P1 picks.
 * Tested with: attrs.blockId (P0 core as shipped in the P0 zip).
 */
import {
  BLOCK_TYPES,
  ensureBlockIds,
  listBlockIds,
  type DocNode,
  type IdGenerator,
  type NoteDoc,
} from '@/core';

/** A structural view of a node, for code that copies attrs generically. */
export interface LooseNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: LooseNode[];
  text?: string;
  marks?: unknown[];
}

export const loose = (n: DocNode): LooseNode => n as unknown as LooseNode;
export const typed = (n: LooseNode): DocNode => n as unknown as DocNode;

export function isBlockType(type: string): boolean {
  return (BLOCK_TYPES as readonly string[]).includes(type);
}

/**
 * The block's own id. In a document with complete ids (checked on entry,
 * see hasCompleteIds), listBlockIds walks the node before its children, so
 * the first id is the node's own.
 */
export function blockIdOf(node: DocNode): string | null {
  if (!isBlockType(node.type)) return null;
  return listBlockIds({ type: 'doc', content: [node] })[0] ?? null;
}

/** Every block id inside a node, the node's own first. */
export function idsIn(nodes: readonly DocNode[]): string[] {
  return listBlockIds({ type: 'doc', content: [...nodes] });
}

/** True when every block already has a valid, unique id (nothing to assign). */
export function hasCompleteIds(doc: NoteDoc, ids: IdGenerator): boolean {
  return canonicalJson(ensureBlockIds(doc, ids)) === canonicalJson(doc);
}

/**
 * Deterministic JSON: object keys sorted at every level, so two equal trees
 * always give the same string (ALGORITHMS §6.1, §7). Arrays keep their order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v); // undefined is dropped, as JSON.stringify would
    }
    return out;
  }
  return value;
}

/** Finds a node by block id anywhere in the tree (depth-first). */
export function findNode(doc: NoteDoc, id: string): DocNode | null {
  const stack: DocNode[] = [...doc.content].reverse();
  while (stack.length > 0) {
    const n = stack.pop() as DocNode;
    if (blockIdOf(n) === id) return n;
    const kids = loose(n).content;
    if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(typed(kids[i] as LooseNode));
  }
  return null;
}

/** Deep copy through JSON (documents are plain JSON by schema). */
export function cloneNode<T>(n: T): T {
  return JSON.parse(JSON.stringify(n)) as T;
}
