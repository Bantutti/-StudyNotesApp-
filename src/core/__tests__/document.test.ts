import {
  countBlocks,
  DOC_LIMITS,
  ensureBlockIds,
  listBlockIds,
  makeLongSample,
  parseNoteDocJson,
  SAMPLE_NOTE,
  validateNoteDoc,
  type NoteDoc,
} from '../document';
import { createSeqIdGenerator } from '../ids';

const p = (content: unknown[]) => ({ type: 'doc', content });

describe('note document schema', () => {
  it('accepts the sample note', () => {
    expect(validateNoteDoc(SAMPLE_NOTE).ok).toBe(true);
  });

  it('rejects unknown node and mark types', () => {
    expect(validateNoteDoc(p([{ type: 'script', text: 'x' }])).ok).toBe(false);
    expect(validateNoteDoc(p([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'onclick' }] }] }])).ok).toBe(false);
  });

  it('rejects javascript: and data: links', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,hi', 'file:///x']) {
      const doc = p([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }] }]);
      expect(validateNoteDoc(doc).ok).toBe(false);
    }
  });

  it('strips unknown attributes instead of passing them through', () => {
    const r = validateNoteDoc(p([{ type: 'paragraph', attrs: { blockId: null, style: 'x', onclick: 'y' }, content: [] }]));
    expect(r.ok && r.value.content[0]).toEqual({ type: 'paragraph', attrs: { blockId: null }, content: [] });
  });

  it('rejects invalid highlight keys and heading levels', () => {
    expect(validateNoteDoc(p([{ type: 'heading', attrs: { level: 6 }, content: [] }])).ok).toBe(false);
    const hl = p([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight', attrs: { key: '#ff0000' } }] }] }]);
    expect(validateNoteDoc(hl).ok).toBe(false);
  });

  it('enforces depth and size limits', () => {
    let node: Record<string, unknown> = { type: 'paragraph', content: [{ type: 'text', text: 'deep' }] };
    for (let i = 0; i < DOC_LIMITS.maxDepth + 2; i++) node = { type: 'callout', content: [node] };
    const deep = validateNoteDoc(p([node]));
    expect(deep.ok).toBe(false);
    expect(!deep.ok && deep.error.code).toBe('too_large');
    expect(parseNoteDocJson('x'.repeat(DOC_LIMITS.maxJsonBytes + 1)).ok).toBe(false);
    expect(parseNoteDocJson('{not json').ok).toBe(false);
  });
});

describe('block ids', () => {
  it('keeps valid ids, fills missing ones and fixes duplicates', () => {
    const doc: NoteDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'b_keepme00000001' }, content: [] },
        { type: 'paragraph', attrs: { blockId: 'b_keepme00000001' }, content: [] },
        { type: 'paragraph', content: [] },
        { type: 'paragraph', attrs: { blockId: 'not-valid' }, content: [] },
      ],
    };
    const ids = listBlockIds(ensureBlockIds(doc, createSeqIdGenerator()));
    expect(ids[0]).toBe('b_keepme00000001');
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => /^b_[A-Za-z0-9]{10,32}$/.test(id))).toBe(true);
  });

  it('long sample gets unique ids and still validates', () => {
    const long = ensureBlockIds(makeLongSample(25), createSeqIdGenerator());
    expect(validateNoteDoc(long).ok).toBe(true);
    const ids = listBlockIds(long);
    expect(new Set(ids).size).toBe(ids.length);
    expect(countBlocks(long)).toBe(countBlocks(SAMPLE_NOTE) * 25);
  });
});
