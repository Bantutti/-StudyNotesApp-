import { checkDocStructure, ensureBlockIds, createSeqIdGenerator, listBlockIds, SAMPLE_NOTE, validateNoteDoc, type DocNode, type NoteDoc } from '@/core';

const p = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const d = (...content: DocNode[]): NoteDoc => ({ type: 'doc', content });
const cell = (text: string, type: 'tableCell' | 'tableHeader' = 'tableCell'): DocNode => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(text)] });
const row = (...cells: DocNode[]): DocNode => ({ type: 'tableRow', content: cells });

const qa: DocNode = { type: 'qa', content: [{ type: 'qaQuestion', content: [{ type: 'text', text: 'What is osmosis?' }] }, { type: 'qaAnswer', content: [p('Water moving')] }] };
const cornell: DocNode = { type: 'columns', attrs: { layout: 'cornell' }, content: [{ type: 'column', content: [p('cue')] }, { type: 'column', content: [p('notes'), qa] }] };
const table: DocNode = { type: 'table', content: [row(cell('Term', 'tableHeader'), cell('Meaning', 'tableHeader')), row(cell('ATP'), cell('energy'))] };

describe('document schema v2 (P1 blocks)', () => {
  it('accepts quote, summary, Q&A, Cornell columns and tables', () => {
    const doc = d({ type: 'blockquote', content: [p('a quote')] }, { type: 'summary', content: [p('sum')] }, qa, cornell, table);
    const r = validateNoteDoc(doc);
    expect(r.ok).toBe(true);
    expect(checkDocStructure(doc)).toBeNull();
  });

  it('gives every new block type a block id', () => {
    const doc = ensureBlockIds(d(qa, cornell, table), createSeqIdGenerator());
    // qa(4: qa, question, answer, p) | columns(9: columns, 2 columns, 2 p, nested qa 4) | table(11: table, 2 rows, 4 cells, 4 p)
    expect(listBlockIds(doc)).toHaveLength(4 + 9 + 11);
  });

  it('accepts an audio anchor in the P2a shape and rejects bad ones', () => {
    const anchored = (a: unknown) => d({ type: 'paragraph', attrs: { blockId: 'b_aaaaaaaaaaaa', audioAnchor: a } as never, content: [{ type: 'text', text: 'x' }] });
    expect(validateNoteDoc(anchored({ recordingId: 'rec_0000000000000001', startMs: 10, endMs: 20 })).ok).toBe(true);
    expect(validateNoteDoc(anchored(null)).ok).toBe(true);
    expect(validateNoteDoc(anchored({ recordingId: 'rec_0000000000000001', startMs: 30, endMs: 20 })).ok).toBe(false);
    expect(validateNoteDoc(anchored({ recordingId: 'short', startMs: 0, endMs: 1 })).ok).toBe(false);
  });

  it('rejects wrong nesting', () => {
    const bad: DocNode[] = [
      { type: 'qaAnswer', content: [p('loose answer')] }, // not at top level
      { type: 'qa', content: [{ type: 'qaAnswer', content: [p('a')] }, { type: 'qaQuestion' }] }, // wrong order
      { type: 'columns', content: [{ type: 'column', content: [p('only one')] }] },
      { type: 'columns', content: [{ type: 'column', content: [cornell] }, { type: 'column', content: [p('x')] }] }, // nested columns
      { type: 'callout', content: [table] }, // table inside callout
      { type: 'paragraph', content: [p('block inside inline')] },
      { type: 'tableCell', content: [p('cell at top')] },
      { type: 'bulletList', content: [p('not a list item')] },
    ];
    for (const n of bad) expect(validateNoteDoc(d(n)).ok).toBe(false);
  });

  it('rejects ragged tables, merged cells and oversized tables', () => {
    expect(validateNoteDoc(d({ type: 'table', content: [row(cell('a'), cell('b')), row(cell('c'))] })).ok).toBe(false);
    const merged = { type: 'tableCell', attrs: { colspan: 2 }, content: [p('x')] } as unknown as DocNode;
    expect(validateNoteDoc(d({ type: 'table', content: [row(merged)] })).ok).toBe(false);
    const wide = row(...Array.from({ length: 13 }, (_, i) => cell(String(i))));
    expect(validateNoteDoc(d({ type: 'table', content: [wide] })).ok).toBe(false);
  });

  it('still accepts v1 documents (P0 sample shape)', () => {
    expect(validateNoteDoc(SAMPLE_NOTE).ok).toBe(true);
  });
});
