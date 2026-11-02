import { previewPair } from '../conflictPreview';

const note = (title: string, blocks: [string, string][], deleted = 0) => ({
  id: 'n_1', title, deleted,
  document: JSON.stringify({ type: 'doc', content: blocks.map(([id, text]) => ({ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text }] })) }),
});

describe('conflict preview', () => {
  it('marks same, changed, added and removed blocks by block id', () => {
    const p = previewPair(note('Mine', [['b_aaaaaaaaaa', 'same'], ['b_bbbbbbbbbb', 'my edit'], ['b_cccccccccc', 'only mine']]), note('Theirs', [['b_aaaaaaaaaa', 'same'], ['b_bbbbbbbbbb', 'their edit'], ['b_dddddddddd', 'only theirs']]));
    expect(p.mine.lines.map((l) => l.mark)).toEqual(['same', 'changed', 'added']);
    expect(p.theirs.lines.map((l) => l.mark)).toEqual(['same', 'changed', 'removed']);
    expect(p.mine.title).toBe('Mine');
  });

  it('handles a deleted copy and broken JSON without throwing', () => {
    const p = previewPair(null, { id: 'n_1', title: '', deleted: 1, document: '{bad' });
    expect(p.mine.deleted).toBe(true);
    expect(p.theirs.lines).toEqual([]);
  });
});
