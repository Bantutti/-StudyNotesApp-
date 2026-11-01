import { contrast, createPackRegistry, missingFamilies, P1_PACK_IDS, validatePack } from '../index';

describe('P1 packs (decision Q1)', () => {
  const reg = createPackRegistry();

  it('ships Pastel Highlight and Clear Read v2, both valid with bundled fonts', () => {
    for (const id of P1_PACK_IDS) {
      const p = reg.get(id);
      expect(p).toBeDefined();
      expect(validatePack(p).ok).toBe(true);
      expect(missingFamilies(p!)).toEqual([]);
    }
    expect(reg.get('clear-read')?.version).toBe(2);
    expect(reg.get('clear-read')?.fonts.body).toBe('Atkinson Hyperlegible');
  });

  it('Clear Read v2 has the same 4 highlighter meanings as Pastel Highlight, in the same order', () => {
    const meanings = (id: string) => reg.get(id)!.highlighters.map((h) => h.meaning);
    expect(meanings('clear-read')).toEqual(['Key idea', 'Definition', 'Example', 'Formula']);
    expect(meanings('clear-read')).toEqual(meanings('pastel-highlight'));
  });

  it('Clear Read keeps body text far above AA on every highlighter (high-legibility pack)', () => {
    const p = reg.get('clear-read')!;
    for (const h of p.highlighters) expect(contrast(p.palette.ink, h.color)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.palette.ink, p.paper.color)).toBeGreaterThanOrEqual(7);
  });
});
