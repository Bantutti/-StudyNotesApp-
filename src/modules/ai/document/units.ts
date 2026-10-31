/**
 * Scope -> units: the flat list of text blocks the AI sees.
 *
 * Rules (ALGORITHMS §4, Rey Nov 1 Q5 = A):
 * - Each unit gets a short alias (u1, u2, ... in document order). The AI only
 *   ever sees aliases; real block ids never leave the device in a prompt.
 * - Editable units: top-level paragraph / heading / callout / definition
 *   whose children are plain paragraphs, and list items whose content is
 *   one paragraph followed only by nested lists.
 * - Anything else inside the scope (complex callouts, unusual list items) is
 *   sent read-only, for context. Empty paragraphs and dividers are skipped.
 * - Nodes outside the scope are never sent and never touched.
 */
import type { DocNode, HighlightKey, NoteDoc } from '@/core';

import { renderInline, type LinkRef } from './marks';
import { blockIdOf, loose, typed, type LooseNode } from './nodes';

/** The block kinds the AI reads and writes. */
export const AI_BLOCK_KINDS = ['paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'callout', 'definition'] as const;
export type AiBlockKind = (typeof AI_BLOCK_KINDS)[number];

export type AiScope = { kind: 'note' } | { kind: 'blocks'; blockIds: readonly string[] };

export interface Unit {
  /** Short alias sent to the AI ("u7"). */
  alias: string;
  /** Real block id (never sent). */
  blockId: string;
  kind: AiBlockKind;
  /** Definition term, else null. */
  term: string | null;
  /** Marked text (ALGORITHMS §5.1). Callout/definition paragraphs joined by '\n'. */
  text: string;
  /** True when the AI may only read this unit. */
  readOnly: boolean;
  /** 'top' = child of the doc; 'list' = a listItem inside a list. */
  context: 'top' | 'list';
  /** List nesting depth (0 for top-level blocks and first-level items). */
  depth: number;
  /** Id of the top-level ancestor (itself for top-level units). */
  topId: string;
  /** The original node at extraction time (snapshot for diffs and stale checks). */
  node: DocNode;
  links: LinkRef[];
  highlightKey: HighlightKey | null;
}

interface Ctx {
  context: 'top' | 'list';
  depth: number;
  topId: string;
  listKind: 'bullet' | 'numbered';
  /** An ancestor block was selected, so everything below is in scope. */
  inherited: boolean;
}

/** Joins the rendered text of paragraph children with '\n'. */
function renderParagraphs(children: readonly LooseNode[]) {
  const parts = children.map((c) => renderInline(c.content as DocNode[] | undefined));
  return {
    text: parts.map((p) => p.text).join('\n'),
    links: parts.flatMap((p) => p.links),
    highlightKey: parts.find((p) => p.highlightKey)?.highlightKey ?? null,
  };
}

/** Every paragraph at any depth, in order (context text for read-only units). */
function allParagraphs(nodes: readonly LooseNode[]): LooseNode[] {
  const out: LooseNode[] = [];
  const walk = (ns: readonly LooseNode[]) => {
    for (const n of ns) {
      if (n.type === 'paragraph') out.push(n);
      else walk(n.content ?? []);
    }
  };
  walk(nodes);
  return out;
}

/** Every id inside a node (used to test "a descendant was selected"). */
function anyIdIn(node: LooseNode, selected: ReadonlySet<string>): boolean {
  const stack: LooseNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop() as LooseNode;
    const id = blockIdOf(typed(n));
    if (id && selected.has(id)) return true;
    for (const c of n.content ?? []) stack.push(c);
  }
  return false;
}

export function extractUnits(doc: NoteDoc, scope: AiScope): Unit[] {
  const selected = scope.kind === 'blocks' ? new Set(scope.blockIds) : null;
  const units: Omit<Unit, 'alias'>[] = [];

  /** In scope when: whole note, an ancestor or the unit itself is selected,
   *  or (for "own" children such as callout paragraphs) a child is selected. */
  const inScope = (ctx: Ctx, id: string, ownChildren: readonly LooseNode[]): boolean => {
    if (!selected) return true;
    if (ctx.inherited || selected.has(id)) return true;
    return ownChildren.some((c) => anyIdIn(c, selected));
  };

  const push = (u: Omit<Unit, 'alias'>, ctx: Ctx, own: readonly LooseNode[]) => {
    if (inScope(ctx, u.blockId, own)) units.push(u);
  };

  const visit = (node: DocNode, ctx: Ctx): void => {
    const n = loose(node);
    const id = blockIdOf(node);
    if (!id) return;
    const childCtx: Ctx = { ...ctx, inherited: ctx.inherited || (selected?.has(id) ?? false) };
    const kids = n.content ?? [];
    const base = { blockId: id, context: ctx.context, depth: ctx.depth, topId: ctx.topId, node };

    switch (n.type) {
      case 'paragraph': {
        if (ctx.context !== 'top') return;
        const r = renderInline(kids as DocNode[]);
        if (r.text.trim() === '') return; // empty lines are left alone
        push({ ...base, kind: 'paragraph', term: null, text: r.text, readOnly: false, links: r.links, highlightKey: r.highlightKey }, ctx, []);
        return;
      }
      case 'heading': {
        const level = (n.attrs?.level as number) ?? 1;
        const r = renderInline(kids as DocNode[]);
        if (r.text.trim() === '') return;
        const kind = (level === 1 ? 'heading1' : level === 2 ? 'heading2' : 'heading3') as AiBlockKind;
        push({ ...base, kind, term: null, text: r.text, readOnly: false, links: r.links, highlightKey: r.highlightKey }, ctx, []);
        return;
      }
      case 'callout':
      case 'definition': {
        const simple = kids.every((c) => c.type === 'paragraph');
        // Complex callouts/definitions are read-only; their whole text is context.
        const r = renderParagraphs(simple ? kids : allParagraphs(kids));
        const term = n.type === 'definition' ? String(n.attrs?.term ?? '') : null;
        push(
          { ...base, kind: n.type, term, text: r.text, readOnly: !simple, links: r.links, highlightKey: r.highlightKey },
          ctx,
          kids,
        );
        return;
      }
      case 'bulletList':
      case 'orderedList': {
        const listKind = n.type === 'bulletList' ? 'bullet' : 'numbered';
        const depth = ctx.context === 'list' ? ctx.depth + 1 : 0;
        for (const item of kids) visit(typed(item), { ...childCtx, context: 'list', depth, listKind });
        return;
      }
      case 'listItem': {
        const [first, ...rest] = kids;
        const simple = first?.type === 'paragraph' && rest.every((c) => c.type === 'bulletList' || c.type === 'orderedList');
        const own = first?.type === 'paragraph' ? [first] : [];
        const r = simple ? renderInline(first?.content as DocNode[] | undefined) : renderParagraphs(kids.filter((c) => c.type === 'paragraph'));
        if (r.text.trim() !== '' || !simple) {
          push(
            { ...base, kind: ctx.listKind, term: null, text: r.text, readOnly: !simple, links: r.links, highlightKey: r.highlightKey },
            ctx,
            own,
          );
        }
        // Nested lists are their own units.
        for (const c of kids) if (c.type === 'bulletList' || c.type === 'orderedList') visit(typed(c), childCtx);
        return;
      }
      default:
        return; // horizontalRule and future block types: not sent
    }
  };

  for (const top of doc.content) {
    const topId = blockIdOf(top);
    if (!topId) continue;
    visit(top, { context: 'top', depth: 0, topId, listKind: 'bullet', inherited: false });
  }
  return units.map((u, i) => ({ ...u, alias: `u${i + 1}` }));
}

/** alias -> unit lookup. */
export function aliasMap(units: readonly Unit[]): Map<string, Unit> {
  return new Map(units.map((u) => [u.alias, u]));
}
