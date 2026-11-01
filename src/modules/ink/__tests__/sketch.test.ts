/**
 * P4b sketch block (decision Q2): core schema, structure rules, and the P2a
 * cloud contract. P2a's content check is structural (node names by pattern,
 * top-level blockId required), so a sketch note syncs with NO firebase/ edit.
 */
import { checkDocStructure, createSeqIdGenerator, ensureBlockIds, prepareDocForSave, SKETCH_HEIGHT, validateNoteDoc, type NoteDoc } from '@/core';
import { renderNodes } from '../../export/html';

import * as p2a from '../../../../firebase/src/schemas';

const sketch = (height: number, blockId = 'b_SKETCH00000001') => ({ type: 'sketch' as const, attrs: { blockId, height } });
const para = (text: string, blockId: string) => ({ type: 'paragraph' as const, attrs: { blockId }, content: [{ type: 'text' as const, text }] });
const doc = (...content: NoteDoc['content']): NoteDoc => ({ type: 'doc', content });

describe('sketch block in the note document', () => {
  it('is a valid top-level block with a clamped height', () => {
    expect(validateNoteDoc(doc(para('Cell diagram', 'b_PARA000000001'), sketch(400))).ok).toBe(true);
    expect(validateNoteDoc(doc(sketch(SKETCH_HEIGHT.min - 1))).ok).toBe(false);
    expect(validateNoteDoc(doc(sketch(SKETCH_HEIGHT.max + 1))).ok).toBe(false);
    expect(validateNoteDoc(doc({ type: 'sketch', attrs: { blockId: 'b_SKETCH00000001', height: 400.5 } } as never)).ok).toBe(false);
  });

  it('is a leaf: content smuggled inside it is stripped (like a divider)', () => {
    const bad = { type: 'doc', content: [{ ...sketch(400), content: [para('hidden text', 'b_PARA000000002')] }] };
    const r = validateNoteDoc(bad);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.value)).not.toContain('hidden text');
      expect(checkDocStructure(r.value)).toBeNull();
    }
  });

  it('may sit in a column, but not inside callouts or lists (simple blocks only)', () => {
    const inColumn = doc({
      type: 'columns',
      attrs: { blockId: 'b_COLS000000001' },
      content: [
        { type: 'column', attrs: { blockId: 'b_COL0000000001' }, content: [sketch(300, 'b_SKETCH00000002')] },
        { type: 'column', attrs: { blockId: 'b_COL0000000002' }, content: [para('notes', 'b_PARA000000003')] },
      ],
    });
    expect(validateNoteDoc(inColumn).ok).toBe(true);
    const inCallout = doc({ type: 'callout', attrs: { blockId: 'b_CALL000000001' }, content: [sketch(300, 'b_SKETCH00000003')] });
    expect(validateNoteDoc(inCallout).ok).toBe(false);
  });

  it('gets a block id like every block (ink anchors to it)', () => {
    const d = ensureBlockIds(doc({ type: 'sketch', attrs: { height: 400 } }), createSeqIdGenerator());
    expect(d.content[0]).toMatchObject({ type: 'sketch', attrs: { blockId: expect.stringMatching(/^b_/), height: 400 } });
  });

  it('passes P2a cloud schemas unchanged (no firebase/ edit needed)', () => {
    const prepared = prepareDocForSave(doc(para('Diagram:', 'b_PARA000000004'), sketch(600)), createSeqIdGenerator());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(p2a.noteDocumentSchema.safeParse(prepared.value.doc).success).toBe(true);
    // A top-level sketch without an id is rejected by the cloud, like every block (ensureBlockIds fixes it first).
    expect(p2a.noteDocumentSchema.safeParse(doc({ type: 'sketch', attrs: { height: 400 } } as never)).success).toBe(false);
  });

  it('exports as an empty frame of the stored height (P6 adds the ink)', () => {
    const html = renderNodes(doc(sketch(480)).content);
    expect(html).toContain('<div class="pk-sketch" style="height:480px"></div>');
  });
});
