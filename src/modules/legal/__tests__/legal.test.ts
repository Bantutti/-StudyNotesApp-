import { LEGAL_DOCS, LEGAL_SOURCE, isLegalDocId, parseInline, parseMarkdown } from '../index';

describe('bundled legal pages', () => {
  it('are pinned to C1 commit e78a01a and start with the Draft line', () => {
    expect(LEGAL_SOURCE.commit.startsWith('e78a01a')).toBe(true);
    for (const d of Object.values(LEGAL_DOCS)) expect(d.markdown.startsWith('> **Draft:**')).toBe(true);
    expect(Object.keys(LEGAL_DOCS).sort()).toEqual(['delete-account', 'privacy', 'terms']);
  });

  it('links between the pages stay in the app; other links become plain text', () => {
    expect(parseInline('see [Terms](terms.md) and [x](https://evil.example)')).toEqual([
      { text: 'see ' },
      { text: 'Terms', link: 'terms' },
      { text: ' and ' },
      { text: 'x' },
    ]);
  });

  it('shows placeholders as "to be added", bold, lists and notes', () => {
    const b = parseMarkdown('> **Draft:** x\n\n# T\n\nEmail **{{CONTACT_EMAIL}}**.\n\n- a\n1. b');
    expect(b.map((x) => x.kind)).toEqual(['note', 'heading', 'paragraph', 'bullet', 'numbered']);
    expect(JSON.stringify(b)).toContain('(to be added)');
    expect(JSON.stringify(b)).not.toContain('{{');
  });

  it('every page parses and only valid ids are accepted', () => {
    for (const d of Object.values(LEGAL_DOCS)) expect(parseMarkdown(d.markdown).length).toBeGreaterThan(5);
    expect(isLegalDocId('privacy')).toBe(true);
    expect(isLegalDocId('../etc')).toBe(false);
  });
});
