import type { NoteDoc } from './schema';

/**
 * Built-in SAMPLE note used by the spikes. It is representative content,
 * not user data, and the UI labels it "Sample note".
 */
export const SAMPLE_NOTE_TITLE = 'Osmosis & Diffusion (sample note)';

export const SAMPLE_NOTE: NoteDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1, blockId: 'b_sample000000001' },
      content: [{ type: 'text', text: 'Osmosis & Diffusion' }],
    },
    {
      type: 'paragraph',
      attrs: { blockId: 'b_sample000000002' },
      content: [
        { type: 'text', text: 'Both are kinds of ' },
        { type: 'text', text: 'passive transport', marks: [{ type: 'highlight', attrs: { key: 'k0' } }] },
        { type: 'text', text: ': no energy (' },
        { type: 'text', text: 'ATP', marks: [{ type: 'bold' }] },
        { type: 'text', text: ') needed. Particles follow the ' },
        { type: 'text', text: 'concentration gradient', marks: [{ type: 'highlight', attrs: { key: 'k3' } }] },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'definition',
      attrs: { term: 'Osmosis', blockId: 'b_sample000000003' },
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'b_sample000000004' },
          content: [
            { type: 'text', text: 'Movement of ' },
            { type: 'text', text: 'water', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' across a semi-permeable membrane toward the ' },
            { type: 'text', text: 'higher solute', marks: [{ type: 'highlight', attrs: { key: 'k1' } }] },
            { type: 'text', text: ' concentration.' },
          ],
        },
      ],
    },
    {
      type: 'callout',
      attrs: { blockId: 'b_sample000000005' },
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'b_sample000000006' },
          content: [
            { type: 'text', text: 'Exam tip! ', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'Know the three solution types and what happens to the cell.' },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2, blockId: 'b_sample000000007' },
      content: [{ type: 'text', text: 'Solution types' }],
    },
    {
      type: 'bulletList',
      attrs: { blockId: 'b_sample000000008' },
      content: [
        {
          type: 'listItem',
          attrs: { blockId: 'b_sample000000009' },
          content: [
            {
              type: 'paragraph',
              attrs: { blockId: 'b_sample000000010' },
              content: [
                { type: 'text', text: 'Hypotonic:', marks: [{ type: 'bold' }] },
                { type: 'text', text: ' less solute outside, water moves in' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          attrs: { blockId: 'b_sample000000011' },
          content: [
            {
              type: 'paragraph',
              attrs: { blockId: 'b_sample000000012' },
              content: [
                { type: 'text', text: 'Hypertonic:', marks: [{ type: 'bold' }] },
                { type: 'text', text: ' more solute outside, water moves out' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          attrs: { blockId: 'b_sample000000013' },
          content: [
            {
              type: 'paragraph',
              attrs: { blockId: 'b_sample000000014' },
              content: [
                { type: 'text', text: 'Isotonic:', marks: [{ type: 'bold' }] },
                { type: 'text', text: ' ' },
                { type: 'text', text: 'equal, no net movement', marks: [{ type: 'highlight', attrs: { key: 'k2' } }] },
              ],
            },
          ],
        },
      ],
    },
    { type: 'horizontalRule', attrs: { blockId: 'b_sample000000015' } },
    {
      type: 'paragraph',
      attrs: { blockId: 'b_sample000000016' },
      content: [
        { type: 'text', text: 'Taglish check: ' },
        { type: 'text', text: 'Pag hypertonic ang solution, lalabas ang tubig sa cell.', marks: [{ type: 'italic' }] },
      ],
    },
  ],
};

/** A long synthetic note (repeated sample blocks) for load-time tests. */
export function makeLongSample(repeats: number): NoteDoc {
  const content: NoteDoc['content'] = [];
  for (let i = 0; i < repeats; i++) {
    for (const n of SAMPLE_NOTE.content) {
      const copy = JSON.parse(JSON.stringify(n)) as Record<string, unknown>;
      stripIds(copy);
      content.push(copy as unknown as NoteDoc['content'][number]);
    }
  }
  return { type: 'doc', content };
}

function stripIds(node: Record<string, unknown>): void {
  const attrs = node.attrs as Record<string, unknown> | undefined;
  if (attrs && 'blockId' in attrs) attrs.blockId = null;
  const kids = node.content as Record<string, unknown>[] | undefined;
  if (kids) kids.forEach(stripIds);
}
