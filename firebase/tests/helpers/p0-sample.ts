/**
 * p0-sample.ts — P0's built-in SAMPLE note, copied so P2a's cloud-boundary
 * check is tested against the document shape the app actually produces.
 *
 * SOURCE (copied verbatim, content only; the TypeScript type is dropped):
 *   repo   Bantutti/-StudyNotesApp-, branch main @ a234a48
 *   file   src/core/document/sample.ts (git blob 846e90c7c4a5fc7bd43e33c93d8ec90d61099404)
 *   export SAMPLE_NOTE
 * It's representative content, not user data (P0's UI labels it "Sample note").
 *
 * Why a copy instead of an import: firebase/ is its own npm package with its
 * own tsconfig, and P2a must not import another module's internals (build
 * rule 2). If P0 changes SAMPLE_NOTE, refresh this copy and its blob SHA above.
 *
 * Shape it covers (DATA_MODEL §D.4.3):
 *   - ids in attrs.blockId, "b_" + 15 chars (P0's sample ids; P0's real
 *     generator makes "b_" + 16, covered separately in schemas.test.ts)
 *   - nested blocks: definition > paragraph, callout > paragraph,
 *     bulletList > listItem > paragraph, each with its own blockId
 *   - a definition block with attrs.term, highlight marks with attrs.key,
 *     and a horizontalRule with no content
 */
export const P0_SAMPLE_NOTE = {
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
} as const;

/**
 * Deep copy with every node's attrs passed through `fn` (used to build the
 * "old key" and "null id" variants without hand-editing 16 blocks).
 * Pure: never mutates P0_SAMPLE_NOTE.
 */
export function mapSampleAttrs(fn: (attrs: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  const visit = (node: unknown): unknown => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return node;
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = { ...src };
    // Only node-level attrs are mapped; mark attrs (e.g. highlight key) are left alone.
    if (src.attrs !== undefined) out.attrs = fn({ ...(src.attrs as Record<string, unknown>) });
    if (Array.isArray(src.content)) out.content = (src.content as unknown[]).map(visit);
    return out;
  };
  return visit(JSON.parse(JSON.stringify(P0_SAMPLE_NOTE))) as Record<string, unknown>;
}
