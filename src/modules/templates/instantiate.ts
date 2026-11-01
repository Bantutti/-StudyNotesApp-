/**
 * Template -> note document. Every block gets a FRESH id from the injected
 * generator, so two notes from the same template never share block ids
 * (cards and anchors stay unique to their note).
 */
import { ensureBlockIds, type DocNode, type IdGenerator, type NoteDoc } from '@/core';

import type { BlockSpec, SimpleSpec, Template } from './schema';

export interface InstantiateOptions {
  ids: IdGenerator;
  /** Text for the {kind:'date'} block, e.g. "Sunday, 1 November 2026". */
  dateText: string;
}

const txt = (s: string): DocNode[] => (s ? [{ type: 'text', text: s }] : []);
const para = (s: string): DocNode => ({ type: 'paragraph', content: txt(s) });
const list = (type: 'bulletList' | 'orderedList', items: readonly string[]): DocNode => ({
  type,
  content: items.map((i) => ({ type: 'listItem', content: [para(i)] })),
});

function simple(s: SimpleSpec): DocNode {
  switch (s.kind) {
    case 'heading':
      return { type: 'heading', attrs: { level: s.level }, content: txt(s.text) };
    case 'paragraph':
      return para(s.text);
    case 'bullets':
      return list('bulletList', s.items);
    case 'numbered':
      return list('orderedList', s.items);
  }
}

function block(s: BlockSpec, o: InstantiateOptions): DocNode {
  switch (s.kind) {
    case 'title':
      return { type: 'heading', attrs: { level: 1 }, content: txt(s.text) };
    case 'date':
      return para(o.dateText);
    case 'heading':
    case 'paragraph':
    case 'bullets':
    case 'numbered':
      return simple(s);
    case 'callout':
      return { type: 'callout', content: [para(s.text)] };
    case 'definition':
      return { type: 'definition', attrs: { term: s.term }, content: [para(s.text)] };
    case 'summary':
      return { type: 'summary', content: [para(s.text)] };
    case 'qa':
      return {
        type: 'qa',
        content: [
          { type: 'qaQuestion', content: txt(s.question) },
          { type: 'qaAnswer', content: [para(s.answer)] },
        ],
      };
    case 'quote':
      return { type: 'blockquote', content: [para(s.text)] };
    case 'divider':
      return { type: 'horizontalRule' };
    case 'columns':
      return {
        type: 'columns',
        attrs: { layout: s.layout },
        content: [
          { type: 'column', content: s.left.map(simple) },
          { type: 'column', content: s.right.map(simple) },
        ],
      };
    case 'table': {
      const row = (cells: string[], header: boolean): DocNode => ({
        type: 'tableRow',
        content: cells.map((c) => ({ type: header ? 'tableHeader' : 'tableCell', content: [para(c)] })),
      });
      return {
        type: 'table',
        content: [row(s.header, true), ...Array.from({ length: s.rows }, () => row(s.header.map(() => ''), false))],
      };
    }
  }
}

/** The template's blocks, each with a fresh unique block id. */
export function templateBlocks(t: Template, o: InstantiateOptions): DocNode[] {
  return ensureBlockIds({ type: 'doc', content: t.skeleton.map((s) => block(s, o)) }, o.ids).content;
}

export function instantiateTemplate(t: Template, o: InstantiateOptions): NoteDoc {
  return { type: 'doc', content: templateBlocks(t, o) };
}

/**
 * Applies a template to an existing note: an empty note is replaced, a note
 * with content keeps everything (same ids) and gets the template's sections
 * added below. The template's title block is dropped when appending.
 */
export function applyTemplateTo(doc: NoteDoc, t: Template, o: InstantiateOptions): NoteDoc {
  const isEmpty = doc.content.every((n) => n.type === 'paragraph' && !(n.content ?? []).length);
  if (isEmpty) return instantiateTemplate(t, o);
  const blocks = templateBlocks({ ...t, skeleton: t.skeleton.filter((s) => s.kind !== 'title') }, o);
  // Guard: the existing note keeps its ids; fresh ids can't collide (ensureBlockIds re-checks).
  return ensureBlockIds({ type: 'doc', content: [...doc.content, ...blocks] }, o.ids);
}

/** "Sunday, 1 November 2026" in the phone's language-neutral English form. */
export function formatTemplateDate(ms: number): string {
  const d = new Date(ms);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
