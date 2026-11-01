/**
 * Stable block ids (decision Q6 = A, "smart paste").
 *
 * After every document change, one appendTransaction pass makes ids valid,
 * unique and STABLE:
 *  1. Duplicates (paste of a copy, duplicate block): the block that existed
 *     before keeps the id (found by mapping its old position); the copy gets
 *     a fresh id. (P0 kept the first in document order, so a copy pasted
 *     ABOVE its original stole the id.)
 *  2. Paste from elsewhere: pasted blocks get fresh ids, EXCEPT blocks cut
 *     from this note in the last 10 minutes (cut + paste = move, so cards
 *     and anchors follow the text).
 *  3. Lost ids: when a command rebuilds a block in place (turn into heading,
 *     paragraph, ...), the id that vanished is given back to the block now
 *     at its mapped position, if it holds the same text (so a deleted
 *     block's id is never moved onto another block).
 *  4. Missing or malformed ids get fresh ones.
 *  5. A split that skipped our Enter shortcut (some keyboards split the
 *     block directly; the DOM route even copies the id into both halves):
 *     when a block's text moved whole into the next block of the same type
 *     and the original is left empty, the id moves with the text and the
 *     empty line gets a fresh id. Same result as the Enter shortcut.
 * IME safety: nothing runs while the view is composing (Gboard, iOS
 * keyboards); the pass runs once composition ends. Its transaction never
 * enters undo history.
 */
import { Extension } from '@tiptap/core';
import { Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';

import { BLOCK_ID, BLOCK_TYPES } from '../../src/core/document/schema';

export type RandomBytes = (n: number) => Uint8Array;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz';

export function makeIdFactory(random: RandomBytes) {
  return () => {
    const bytes = random(16);
    let s = 'b_';
    for (let i = 0; i < 16; i++) s += ALPHABET[(bytes[i] as number) % ALPHABET.length];
    return s;
  };
}

const TYPES = new Set<string>(BLOCK_TYPES);
const CUT_MEMORY_MS = 10 * 60 * 1000;
const CUT_MEMORY_MAX = 2_000;
export const blockIdKey = new PluginKey<BlockIdState>('blockId');

interface BlockIdState {
  /** id -> time it was cut from this note */
  cut: Map<string, number>;
}

function idsWithPos(doc: PMNode): Map<string, number> {
  return new Map([...idsWithNodes(doc)].map(([id, v]) => [id, v.pos]));
}

function idsWithNodes(doc: PMNode): Map<string, { pos: number; text: string }> {
  const out = new Map<string, { pos: number; text: string }>();
  doc.descendants((node, pos) => {
    if (!TYPES.has(node.type.name)) return;
    const id = node.attrs.blockId as unknown;
    if (typeof id === 'string' && BLOCK_ID.test(id) && !out.has(id)) out.set(id, { pos, text: node.textContent });
  });
  return out;
}

/** Markdown-style markers an input rule removes when it retypes a line ("# ", "- ", "1. ", "> "). */
const MARKER = /^(#{1,3}|[-*+]|\d{1,3}[.)]|>)\s?/;

/** Same block, rebuilt: identical text, or the text minus an input-rule marker. */
function sameText(old: string | undefined, now: string): boolean {
  if (old === undefined) return false;
  return old === now || old.replace(MARKER, '') === now;
}

const uiEvent = (trs: readonly Transaction[], name: string) => trs.some((t) => t.getMeta('uiEvent') === name);

/** The id fix-up pass, exported for tests. Returns null when nothing changes. */
export function fixBlockIds(
  trs: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
  newId: () => string,
  cut: ReadonlyMap<string, number>,
): Transaction | null {
  const oldNodes = idsWithNodes(oldState.doc);
  const oldIds = new Map([...oldNodes].map(([id, v]) => [id, v.pos]));
  const mapping = new Mapping();
  trs.forEach((t) => mapping.appendMapping(t.mapping));
  const isPaste = uiEvent(trs, 'paste');

  // Where each old id's block should be now.
  const expected = new Map<string, number[]>();
  for (const [id, pos] of oldIds) expected.set(id, [mapping.map(pos, 1), mapping.map(pos, -1)]);

  // Occurrences of every id in the new doc.
  const seenAt = new Map<string, number[]>();
  newState.doc.descendants((node, pos) => {
    if (!TYPES.has(node.type.name)) return;
    const id = node.attrs.blockId as unknown;
    if (typeof id === 'string' && BLOCK_ID.test(id)) seenAt.set(id, [...(seenAt.get(id) ?? []), pos]);
  });
  const lost = [...oldIds.keys()].filter((id) => !seenAt.has(id));
  const lostAt = new Map<number, string>();
  for (const id of lost) for (const p of expected.get(id) ?? []) if (!lostAt.has(p)) lostAt.set(p, id);

  // 5. split fallback: id X's whole text now sits in the next same-type block (no id, or a copy of X)
  const moveTo = new Map<number, string>();
  const dropAt = new Set<number>();
  if (!isPaste) {
    const blocks: { pos: number; node: PMNode; id: string | null }[] = [];
    newState.doc.descendants((node, pos) => {
      if (!TYPES.has(node.type.name)) return;
      const raw = node.attrs.blockId as unknown;
      blocks.push({ pos, node, id: typeof raw === 'string' && BLOCK_ID.test(raw) ? raw : null });
    });
    blocks.forEach((b, i) => {
      if (!b.id || b.node.textContent !== '' || dropAt.has(b.pos)) return;
      const oldText = oldNodes.get(b.id)?.text;
      if (!oldText) return;
      const end = b.pos + b.node.nodeSize;
      const next = blocks.slice(i + 1).find((c) => c.pos >= end && c.node.type === b.node.type);
      if (!next || (next.id !== null && next.id !== b.id) || next.node.textContent !== oldText) return;
      dropAt.add(b.pos);
      moveTo.set(next.pos, b.id);
    });
  }

  const used = new Set<string>();
  const tr = newState.tr;
  let changed = false;
  const assign = (pos: number, node: PMNode, id: string) => {
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id });
    changed = true;
  };

  newState.doc.descendants((node, pos) => {
    if (!TYPES.has(node.type.name)) return;
    const raw = node.attrs.blockId as unknown;
    const moved = moveTo.get(pos);
    if (moved && !used.has(moved)) {
      used.add(moved);
      if (raw !== moved) assign(pos, node, moved);
      return;
    }
    if (dropAt.has(pos)) {
      const fresh = newId();
      used.add(fresh);
      assign(pos, node, fresh);
      return;
    }
    const id = typeof raw === 'string' && BLOCK_ID.test(raw) ? raw : null;
    if (id === null) {
      // 3. a block rebuilt in place (same position, same text) gets its vanished id back;
      //    a deleted block's id is never resurrected on a different block
      const back = lostAt.get(pos);
      if (back && !used.has(back) && !seenAt.has(back) && sameText(oldNodes.get(back)?.text, node.textContent)) {
        used.add(back);
        assign(pos, node, back);
      } else {
        const fresh = newId();
        used.add(fresh);
        assign(pos, node, fresh);
      }
      return;
    }
    const all = seenAt.get(id) ?? [pos];
    let keep: boolean;
    if (used.has(id)) keep = false;
    else if (all.length > 1) {
      // 1. duplicates: the block that existed before (mapped position) keeps it
      const exp = expected.get(id);
      const owner = exp ? all.find((p) => exp.includes(p)) : undefined;
      keep = owner !== undefined ? owner === pos : all[0] === pos && oldIds.has(id);
    } else {
      // 2. pasted from outside this note (and not cut from it): fresh id
      keep = !(isPaste && !oldIds.has(id) && !cut.has(id));
    }
    if (keep) used.add(id);
    else {
      const fresh = newId();
      used.add(fresh);
      assign(pos, node, fresh);
    }
  });
  return changed ? tr.setMeta('addToHistory', false).setMeta(blockIdKey, 'fix') : null;
}

export const BlockId = Extension.create<{ newId: () => string }>({
  name: 'blockId',
  addOptions() {
    return { newId: () => 'b_unset' };
  },
  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_TYPES],
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) => {
              const v = el.getAttribute('data-block-id');
              return v && BLOCK_ID.test(v) ? v : null;
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              typeof attrs.blockId === 'string' ? { 'data-block-id': attrs.blockId } : {},
          },
          // Audio anchor (P4): kept in the JSON, never read from or written to
          // HTML (pasted HTML can't carry an anchor), not copied on split.
          audioAnchor: { default: null, keepOnSplit: false, parseHTML: () => null, renderHTML: () => ({}) },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const newId = this.options.newId;
    let view: EditorView | null = null;
    let pendingAfterComposition = false;
    return [
      new Plugin<BlockIdState>({
        key: blockIdKey,
        state: {
          init: () => ({ cut: new Map() }),
          apply(tr, value, oldState, newState) {
            if (!tr.docChanged || tr.getMeta('uiEvent') !== 'cut') return value;
            const now = Date.now();
            const cut = new Map([...value.cut].filter(([, t]) => now - t < CUT_MEMORY_MS));
            const after = idsWithPos(newState.doc);
            for (const id of idsWithPos(oldState.doc).keys()) if (!after.has(id)) cut.set(id, now);
            while (cut.size > CUT_MEMORY_MAX) cut.delete(cut.keys().next().value as string);
            return { cut };
          },
        },
        view(v) {
          view = v;
          return { destroy: () => void (view = null) };
        },
        props: {
          /**
           * Cut + paste inside the note is a move. ProseMirror would merge a
           * pasted first paragraph into the line at the cursor (dropping its
           * id), so a slice that starts with a block cut from this note is
           * pasted as whole blocks instead.
           */
          transformPasted(slice, v) {
            const first = slice.content.firstChild;
            const id = first?.attrs?.blockId as unknown;
            const cut = blockIdKey.getState(v.state)?.cut;
            if (slice.openStart > 0 && first?.isTextblock && typeof id === 'string' && cut?.has(id)) {
              return new Slice(slice.content, 0, slice.openEnd);
            }
            return slice;
          },
          handleDOMEvents: {
            compositionend: (v) => {
              if (pendingAfterComposition) {
                pendingAfterComposition = false;
                // Run the id pass once the keyboard has committed the text.
                setTimeout(() => v.dispatch(v.state.tr.setMeta('blockIdRecheck', true).setMeta('addToHistory', false)), 0);
              }
              return false;
            },
          },
        },
        appendTransaction(trs, oldState, newState) {
          const recheck = trs.some((t) => t.getMeta('blockIdRecheck'));
          if (!recheck && !trs.some((t) => t.docChanged)) return null;
          if (view?.composing) {
            pendingAfterComposition = true;
            return null;
          }
          const cut = blockIdKey.getState(newState)?.cut ?? new Map();
          return fixBlockIds(trs, oldState, newState, newId, cut);
        },
      }),
    ];
  },
});
