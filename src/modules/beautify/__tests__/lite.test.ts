import {
  createSeqIdGenerator,
  inlineText,
  listBlockIds,
  SAMPLE_NOTE,
  validateNoteDoc,
  type DocNode,
  type NoteDoc,
} from '@/core';

import { beautifyLite, dropChars, KEY_TERMS_TITLE } from '../index';

let n = 0;
const id = () => `b_line${String(++n).padStart(10, '0')}`;
const line = (text: string, marks?: DocNode[]): DocNode => ({
  type: 'paragraph',
  attrs: { blockId: id() },
  content: marks ?? (text ? [{ type: 'text', text }] : []),
});
const doc = (...content: DocNode[]): NoteDoc => ({ type: 'doc', content });
const run = (d: NoteDoc) => beautifyLite(d, createSeqIdGenerator());

/** Every word of the student's text, in order, minus markers Beautify may remove. */
function wordsOf(d: NoteDoc): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly DocNode[]) => {
    for (const node of nodes) {
      if (node.type === 'heading' && inlineText(node).trim() === KEY_TERMS_TITLE) return; // added section ends the note
      if (node.type === 'definition') out.push(...node.attrs.term.split(/\s+/));
      if (node.type === 'text') out.push(...node.text.split(/\s+/));
      if ('content' in node && node.content) walk(node.content);
    }
  };
  walk(d.content);
  return out
    .map((w) => w.replace(/^(?:[-*•]|\d+[.)]|Q[:.)]|A[:.)]|::)$/i, '').replace(/:$/, ''))
    .filter((w) => w && w !== '-' && w !== '::');
}

const messy = () =>
  doc(
    line('CELL BIOLOGY'),
    line('Membranes:'),
    line(''),
    line(''),
    line('Osmosis :: movement of water across a membrane'),
    line('Diffusion - particles spread from high to low concentration'),
    line('- passive transport'),
    line('- no ATP needed'),
    line('1. hypotonic'),
    line('2. hypertonic'),
    line('Q: What is ATP?'),
    line('A: The energy currency of the cell'),
    line('Exam: know the three solution types'),
    line('', [{ type: 'text', text: 'The ' }, { type: 'text', text: 'cell wall', marks: [{ type: 'bold' }] }, { type: 'text', text: ' is rigid.' }]),
    line('This is a normal sentence, so it stays a paragraph.'),
    line(''),
    line(''),
  );

describe('Beautify Lite rules', () => {
  it('builds headings, definitions, lists, Q&A, callouts and a Key terms list', () => {
    const { doc: out, report } = run(messy());
    expect(out.content.map((b) => b.type)).toEqual([
      'heading', 'heading', 'paragraph', 'definition', 'definition', 'bulletList', 'orderedList', 'qa', 'callout', 'paragraph', 'paragraph', 'heading', 'bulletList',
    ]);
    expect(inlineText(out.content[1] as DocNode)).toBe('Membranes'); // trailing ":" dropped
    expect(out.content[3]).toMatchObject({ type: 'definition', attrs: { term: 'Osmosis' } });
    expect(inlineText((out.content[3] as { content: DocNode[] }).content[0] as DocNode)).toBe('movement of water across a membrane');
    expect(report).toMatchObject({ headings: 2, definitions: 2, lists: 2, qa: 1, callouts: 1, highlights: 1, blanksRemoved: 3, keyTerms: 3 });
    const terms = (out.content[12] as { content: DocNode[] }).content.map((li) => inlineText((li as { content: DocNode[] }).content[0] as DocNode));
    expect(terms).toEqual(['Osmosis', 'Diffusion', 'cell wall']);
    expect(validateNoteDoc(out).ok).toBe(true);
  });

  it('never changes the student’s words', () => {
    const input = messy();
    expect(wordsOf(run(input).doc)).toEqual(wordsOf(input));
    expect(wordsOf(run(SAMPLE_NOTE).doc)).toEqual(wordsOf(SAMPLE_NOTE));
  });

  it('is idempotent', () => {
    const once = run(messy()).doc;
    const twice = beautifyLite(once, createSeqIdGenerator());
    expect(twice.doc).toEqual(once);
    expect(twice.report.changed).toBe(false);
  });

  it('keeps block ids: the text block keeps the line id, a definition box takes it', () => {
    const input = messy();
    const lineIds = listBlockIds(input);
    const out = run(input).doc;
    const outIds = new Set(listBlockIds(out));
    const dropped = new Set([3, 15, 16]); // the 2nd of two blank lines, and the two blank lines at the end
    for (const lid of lineIds.filter((_, i) => !dropped.has(i))) expect(outIds.has(lid)).toBe(true);
    const def = out.content[3] as DocNode & { attrs: { blockId: string } };
    expect(def.attrs.blockId).toBe(lineIds[4]);
    const bullets = out.content[5] as { content: { content: { attrs: { blockId: string } }[] }[] };
    expect(bullets.content[0]?.content[0]?.attrs.blockId).toBe(lineIds[6]);
    expect(new Set(listBlockIds(out)).size).toBe(listBlockIds(out).length);
  });

  it('leaves structured blocks alone and keeps the sample note’s ids', () => {
    const out = run(SAMPLE_NOTE).doc;
    const before = listBlockIds(SAMPLE_NOTE);
    expect(listBlockIds(out).slice(0, before.length)).toEqual(before);
  });

  it('refreshes the Key terms list instead of adding a second one', () => {
    const once = run(doc(line('Osmosis :: water moves'))).doc;
    const edited = doc(...once.content.slice(0, -2), line('Diffusion :: particles spread'), ...once.content.slice(-2));
    const again = run(edited).doc;
    expect(again.content.filter((b) => b.type === 'heading' && inlineText(b) === KEY_TERMS_TITLE)).toHaveLength(1);
    const list = again.content[again.content.length - 1] as { content: DocNode[] };
    expect(list.content).toHaveLength(2);
    // the unchanged term keeps its list-item id
    const oldItem = (once.content[once.content.length - 1] as { content: DocNode[] }).content[0] as { attrs: { blockId: string } };
    expect((list.content[0] as { attrs: { blockId: string } }).attrs.blockId).toBe(oldItem.attrs.blockId);
  });

  it('does not turn sentences, URLs or long lines into headings or definitions', () => {
    const input = doc(
      line('I went home - it was late.'),
      line('A long sentence that explains a concept in several words and does not end in a colon'),
      line('Is this a question?'),
      line('The ratio is 3 - 2 in most cases, as noted in the reading for this week'),
    );
    const out = run(input).doc;
    expect(out.content.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
  });

  it('dropChars keeps marks on the remaining text', () => {
    const nodes: DocNode[] = [{ type: 'text', text: '- ' }, { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }];
    expect(dropChars(nodes, 2)).toEqual([{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }]);
  });

  it('handles an empty note', () => {
    const out = run(doc(line(''))).doc;
    expect(out.content).toHaveLength(1);
    expect(validateNoteDoc(out).ok).toBe(true);
  });
});
