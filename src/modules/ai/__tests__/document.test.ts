/**
 * Document layer: inline-mark codec (§5), scope units and aliases (§4.1),
 * token estimate and chunking (§1), materializer id inheritance (§4.2).
 */
import { validateNoteDoc, type DocNode } from '@/core';

import { escapeInline, parseInline, plainOf, renderInline, splitByLinks, tokenize } from '../document/marks';
import { materializeListItems, materializeTop, sanitizeAiText } from '../document/materialize';
import { blockIdOf, canonicalJson, hasCompleteIds, idsIn } from '../document/nodes';
import { chunkUnits, estimateTokens, unitTokens, MAX_UNIT_TOKENS } from '../document/tokens';
import { extractUnits } from '../document/units';
import { bid, doc, p, sampleDoc, seededIds, text } from './fixtures';

describe('§5 inline marks', () => {
  it('round-trips every mark through render and parse', () => {
    const content: DocNode[] = [
      text('plain '),
      text('bold', [{ type: 'bold' }]),
      text(' and '),
      text('both', [{ type: 'bold' }, { type: 'italic' }]),
      text(' '),
      text('hi', [{ type: 'highlight', attrs: { key: 'k2' } }]),
      text(' '),
      text('gone', [{ type: 'strike' }]),
      text(' '),
      text('under', [{ type: 'underline' }]),
    ];
    const r = renderInline(content);
    expect(r.text).toBe('plain **bold** and ***both*** ==hi== ~~gone~~ ++under++');
    expect(r.highlightKey).toBe('k2');
    const back = parseInline(r.text, { highlightKey: r.highlightKey });
    expect(canonicalJson(back)).toBe(canonicalJson(content));
  });

  it('escapes marker characters in user text and restores them', () => {
    const s = 'C++ uses a*b and x == y \\ done';
    const esc = escapeInline(s);
    expect(esc).toBe('C\\+\\+ uses a\\*b and x \\=\\= y \\\\ done');
    expect(plainOf(esc)).toBe(s);
  });

  it('treats an unmatched marker as literal text (last odd occurrence)', () => {
    expect(plainOf('5 * 3 = 15')).toBe('5 * 3 = 15');
    const nodes = parseInline('**a** and ** b');
    expect(nodes).toEqual([{ type: 'text', text: 'a', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and ** b' }]);
  });

  it('supports overlapping marks with toggle semantics', () => {
    expect(parseInline('**a *b** c*')).toEqual([
      { type: 'text', text: 'a ', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'italic' }] },
      { type: 'text', text: ' c', marks: [{ type: 'italic' }] },
    ]);
  });

  it('turns newlines into hardBreaks, or spaces in headings', () => {
    expect(parseInline('a\nb')).toEqual([{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }]);
    expect(parseInline('a\nb', { allowBreaks: false })).toEqual([{ type: 'text', text: 'a b' }]);
    expect(parseInline('\n\nx\n')).toEqual([{ type: 'text', text: 'x' }]);
  });

  it('never creates a link from AI text; only re-applies original link texts', () => {
    const fromAi = parseInline('see https://evil.example and [x](javascript:alert(1)) <a href="x">y</a>');
    expect(JSON.stringify(fromAi)).not.toContain('"link"');
    const links = [{ text: 'Khan Academy', href: 'https://www.khanacademy.org/' }];
    const kept = parseInline('Watch **Khan Academy** videos', { links });
    expect(kept).toContainEqual({ type: 'text', text: 'Khan Academy', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://www.khanacademy.org/' } }] });
    expect(splitByLinks('aXa', [{ text: 'X', href: 'h' }])).toEqual([{ text: 'aXa', href: null }]); // 1-char link texts ignored
  });

  it('tokenizes runs of stars into bold and italic markers', () => {
    expect(tokenize('***x***').filter((t) => t.t === 'm')).toEqual([
      { t: 'm', v: ['**', '*'] },
      { t: 'm', v: ['**', '*'] },
    ]);
  });

  it('sanitizes control and bidi-override characters from AI text', () => {
    expect(sanitizeAiText('  a\u202Eb\u0007c\r\nd\n\n\n\ne\t ')).toBe('abc\nd\n\ne');
  });
});

describe('§4.1 units and aliases', () => {
  it('extracts editable units with aliases in document order, skipping empty lines and dividers', () => {
    const units = extractUnits(sampleDoc(), { kind: 'note' });
    expect(units.map((u) => [u.alias, u.kind, u.blockId, u.context, u.depth])).toEqual([
      ['u1', 'heading1', bid(1), 'top', 0],
      ['u2', 'paragraph', bid(2), 'top', 0],
      ['u3', 'bullet', bid(4), 'list', 0],
      ['u4', 'bullet', bid(7), 'list', 1],
      ['u5', 'bullet', bid(9), 'list', 0],
      ['u6', 'definition', bid(11), 'top', 0],
      ['u7', 'callout', bid(13), 'top', 0],
      ['u8', 'paragraph', bid(17), 'top', 0],
    ]);
    expect(units.every((u) => !u.readOnly)).toBe(true);
    expect(units[5]?.term).toBe('Osmosis');
    expect(units[3]?.topId).toBe(bid(3));
    expect(units[7]?.links).toEqual([{ text: 'Khan Academy', href: 'https://www.khanacademy.org/' }]);
  });

  it('selects by block id, including descendants and the unit that owns a selected paragraph', () => {
    const d = sampleDoc();
    expect(extractUnits(d, { kind: 'blocks', blockIds: [bid(3)] }).map((u) => u.blockId)).toEqual([bid(4), bid(7), bid(9)]);
    expect(extractUnits(d, { kind: 'blocks', blockIds: [bid(14)] }).map((u) => u.blockId)).toEqual([bid(13)]);
    expect(extractUnits(d, { kind: 'blocks', blockIds: [bid(8)] }).map((u) => u.blockId)).toEqual([bid(7)]);
    expect(extractUnits(d, { kind: 'blocks', blockIds: ['b_notinthedoc1'] })).toEqual([]);
  });

  it('marks complex blocks read-only', () => {
    const d = doc({ type: 'callout', attrs: { blockId: bid(1) }, content: [p(bid(2), 'x'), { type: 'bulletList', attrs: { blockId: bid(3) }, content: [{ type: 'listItem', attrs: { blockId: bid(4) }, content: [p(bid(5), 'y')] }] }] });
    const units = extractUnits(d, { kind: 'note' });
    // The whole callout (including its inner list) is one read-only context unit.
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ blockId: bid(1), readOnly: true, text: 'x\ny' });
  });

  it('prompt data never includes real block ids', () => {
    const units = extractUnits(sampleDoc(), { kind: 'note' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- keep the import local to this assertion
    const { unitLine } = require('../actions/prompt') as typeof import('../actions/prompt');
    const lines = units.map(unitLine).join('\n');
    for (const u of units) expect(lines).not.toContain(u.blockId);
  });
});

describe('§1 tokens and chunking', () => {
  it('estimates ceil(bytes / 3) and adds per-unit overhead', () => {
    expect(estimateTokens('abcdef')).toBe(2);
    expect(estimateTokens('ñ')).toBe(1); // 2 bytes
    expect(unitTokens({ text: 'abc', term: null })).toBe(1 + 0 + 14);
  });

  it('packs greedily in order and enforces the unit and chunk limits', () => {
    const units = extractUnits(doc(...Array.from({ length: 30 }, (_, i) => p(bid(i + 1), 'x'.repeat(600)))), { kind: 'note' });
    const r = chunkUnits(units, 2_500);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chunks.flat().map((u) => u.alias)).toEqual(units.map((u) => u.alias)); // order kept
    expect(r.chunks.length).toBe(3); // 214 tokens each -> 11 per chunk
    expect(chunkUnits(units, 300, 8)).toEqual({ ok: false, reason: 'too_many_chunks' });
    const huge = extractUnits(doc(p(bid(1), 'y'.repeat(MAX_UNIT_TOKENS * 3 + 3))), { kind: 'note' });
    expect(chunkUnits(huge)).toEqual({ ok: false, reason: 'unit_too_large' });
  });
});

describe('§4.2 materializer keeps ids', () => {
  const units = extractUnits(sampleDoc(), { kind: 'note' });
  const u = (alias: string) => units.find((x) => x.alias === alias) as (typeof units)[number];

  it('the first block inherits the unit id; new blocks have no id yet', () => {
    const nodes = materializeTop(
      [
        { kind: 'heading2', term: null, text: 'Mitochondria' },
        { kind: 'paragraph', term: null, text: 'It makes **energy**.' },
      ],
      u('u2'),
      {},
    );
    expect(nodes[0]).toEqual({ type: 'heading', attrs: { blockId: bid(2), level: 2 }, content: [{ type: 'text', text: 'Mitochondria' }] });
    expect(idsIn([nodes[1] as DocNode])).toEqual([]);
  });

  it('turning a paragraph into bullets moves its id to the first list item', () => {
    const nodes = materializeTop(
      [
        { kind: 'bullet', term: null, text: 'one' },
        { kind: 'bullet', term: null, text: 'two' },
      ],
      u('u2'),
      {},
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe('bulletList');
    expect(idsIn(nodes)).toEqual([bid(2)]); // only the inherited id; list + others get new ids at apply
  });

  it('definitions reuse inner paragraph ids by position and drop shape attrs', () => {
    const [n] = materializeTop([{ kind: 'paragraph', term: null, text: 'Osmosis is water movement' }], u('u6'), {});
    expect(n).toEqual({ type: 'paragraph', attrs: { blockId: bid(11) }, content: [{ type: 'text', text: 'Osmosis is water movement' }] });
    const [d2] = materializeTop([{ kind: 'definition', term: 'Osmosis', text: 'line one\nline two' }], u('u6'), {});
    expect(idsIn([d2 as DocNode])).toEqual([bid(11), bid(12)]);
  });

  it('list items keep their nested lists and the first paragraph id', () => {
    const [item, extra] = materializeListItems(
      [
        { kind: 'heading1', term: null, text: 'Nucleus stores DNA' },
        { kind: 'bullet', term: null, text: 'Has a membrane' },
      ],
      u('u3'),
      {},
    );
    expect(idsIn([item as DocNode])).toEqual([bid(4), bid(5), bid(6), bid(7), bid(8)]);
    expect(blockIdOf(extra as DocNode)).toBeNull();
  });

  it('keeps links when the link text survives', () => {
    const [n] = materializeTop([{ kind: 'paragraph', term: null, text: 'Watch Khan Academy later' }], u('u8'), { links: u('u8').links });
    expect(JSON.stringify(n)).toContain('https://www.khanacademy.org/');
  });
});

describe('nodes helpers', () => {
  it('detects missing ids and canonicalises key order', () => {
    expect(hasCompleteIds(sampleDoc(), seededIds())).toBe(true);
    expect(hasCompleteIds(doc({ type: 'paragraph', content: [text('x')] }), seededIds())).toBe(false);
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(validateNoteDoc(sampleDoc()).ok).toBe(true);
  });
});
