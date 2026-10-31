import {
  BLOCK_ID_ATTR,
  countWords,
  createSeqIdGenerator,
  DOCUMENT_LIMITS,
  documentUsage,
  emptyNoteDoc,
  extractTextBlocks,
  firstLine,
  getBlockId,
  listBlockIds,
  prepareDocForSave,
  SAMPLE_NOTE,
  utf16String,
  type NoteDoc,
} from '@/core';

describe('block id helpers (decision Q7)', () => {
  it('uses attrs.blockId', () => {
    expect(BLOCK_ID_ATTR).toBe('blockId');
    expect(getBlockId({ type: 'paragraph', attrs: { blockId: 'b_abcdefghij01' } })).toBe('b_abcdefghij01');
    expect(getBlockId({ type: 'paragraph', attrs: { id: 'b_abcdefghij01' } })).toBeNull();
    expect(getBlockId({ type: 'paragraph', attrs: { blockId: 'bad id' } })).toBeNull();
    expect(getBlockId(null)).toBeNull();
  });
});

describe('text extraction', () => {
  it('lists text blocks with their ids, including definition terms', () => {
    const blocks = extractTextBlocks(SAMPLE_NOTE);
    expect(blocks[0]).toEqual({ blockId: 'b_sample000000001', kind: 'heading', text: 'Osmosis & Diffusion' });
    expect(blocks).toContainEqual({ blockId: 'b_sample000000003', kind: 'term', text: 'Osmosis' });
    expect(blocks).toContainEqual(expect.objectContaining({ blockId: 'b_sample000000012', kind: 'text' }));
    // list wrappers carry no text of their own
    expect(blocks.some((b) => b.blockId === 'b_sample000000008')).toBe(false);
  });

  it('counts words and finds the first line', () => {
    const d: NoteDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: "Cell's wall — semi-permeable, 2 layers" }] }] };
    expect(countWords(d)).toBe(5);
    expect(firstLine(SAMPLE_NOTE)).toBe('Osmosis & Diffusion');
    expect(firstLine({ type: 'doc', content: [] })).toBe('');
  });
});

describe('prepareDocForSave', () => {
  const ids = () => createSeqIdGenerator();

  it('fills missing ids so every block has a non-null blockId', () => {
    const d: NoteDoc = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'x' }] }] };
    const r = prepareDocForSave(d, ids());
    expect(r.ok && listBlockIds(r.value.doc)).toHaveLength(1);
  });

  it('rejects invalid documents and documents over the cloud cap', () => {
    expect(prepareDocForSave({ type: 'doc', content: [{ type: 'script' }] }, ids()).ok).toBe(false);
    const huge: NoteDoc = { type: 'doc', content: Array.from({ length: 31 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: 'é'.repeat(20_000) }] })) };
    const r = prepareDocForSave(huge, ids());
    expect(r.ok).toBe(false); // ~620k chars and ~1.24 MB
    if (!r.ok) expect(r.error.code).toBe('too_large');
  });

  it('measures usage against the tighter of the two caps', () => {
    expect(documentUsage('a'.repeat(DOCUMENT_LIMITS.maxChars / 2))).toBeCloseTo(0.5);
    expect(documentUsage('é'.repeat(DOCUMENT_LIMITS.maxBytes / 2))).toBeCloseTo(1); // 2 bytes each
  });

  it('makes an empty note with one identified paragraph', () => {
    expect(listBlockIds(emptyNoteDoc(ids()))).toEqual(['b_0000000000000001']);
  });
});

describe('utf16String', () => {
  it('counts UTF-16 units like Firestore rules', () => {
    expect(utf16String(1, 2).safeParse('😀').success).toBe(true);
    expect(utf16String(1, 2).safeParse('😀a').success).toBe(false);
  });
});
