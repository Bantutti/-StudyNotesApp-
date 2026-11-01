import { contrastRatio, ensureContrast, redactFields, setStrings, solidColors, t, tCount, EN } from '@/core';
import { DEFAULT_ACCENT, makeTheme, SUBJECT_COLORS } from '@/core/ui';

describe('chrome tokens (plan 9.5) meet WCAG AA', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const c of [DEFAULT_ACCENT, ...SUBJECT_COLORS.map((x) => `#${x}`)]) {
      it(`${scheme} theme with accent ${c}`, () => {
        const th = makeTheme(scheme, c);
        expect(contrastRatio(th.text, th.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(th.muted, th.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(th.muted, th.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(th.accentText, th.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(th.accent, th.surface)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(th.primary.text, th.primary.fill)).toBeGreaterThanOrEqual(4.5);
        for (const s of [th.successText, th.warnText, th.dangerText]) expect(contrastRatio(s, th.surface)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('fixes the plan accent #4F7CF7 for white button text', () => {
    expect(contrastRatio('#FFFFFF', DEFAULT_ACCENT)).toBeLessThan(4.5);
    const s = solidColors(DEFAULT_ACCENT);
    expect(s.text).toBe('#FFFFFF');
    expect(contrastRatio(s.text, s.fill)).toBeGreaterThanOrEqual(4.5);
    expect(ensureContrast('#1F2328', '#FAF8F5', 4.5)).toBe('#1F2328'); // already fine: unchanged
  });
});

describe('redaction covers P1 fields', () => {
  it('drops titles, terms, queries, tags, snippets and links', () => {
    const out = redactFields({ title: 'Diary', term: 'x', query: 'q', tags: 'a', snippet: 's', preview: 'p', href: 'h', count: 3 });
    expect(Object.values(out).filter((v) => v === '[redacted]')).toHaveLength(7);
    expect(out.count).toBe(3);
  });
});

describe('strings', () => {
  afterEach(() => setStrings(EN));
  it('fills placeholders and plural forms', () => {
    expect(t('home.examIn', { subject: 'Biology', days: 9 })).toBe('Biology exam in 9 days');
    expect(tCount('subjects.noteCount', 1)).toBe('1 note');
    expect(tCount('subjects.noteCount', 4)).toBe('4 notes');
  });
  it('can swap the table (future Filipino strings)', () => {
    setStrings({ ...EN, 'tab.home': 'Tahanan' });
    expect(t('tab.home')).toBe('Tahanan');
  });
});
