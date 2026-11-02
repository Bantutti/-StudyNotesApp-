import pastel from '../packs/pastel-highlight.json';
import { contrast, composite } from '../color';
import { fontFaceCss } from '../fontFace';
import { loadFaces } from '../fonts';
import { createPackRegistry, DEFAULT_PACK_ID } from '../registry';
import { packCss, packVars } from '../theme';
import { validatePack } from '../validate';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('bundled packs', () => {
  const reg = createPackRegistry();
  it('all 13 packs pass schema and contrast rules', () => {
    expect(reg.rejected).toEqual([]);
    expect(reg.list()).toHaveLength(13);
    expect(reg.get(DEFAULT_PACK_ID)?.name).toBe('Pastel Highlight');
  });
  it('falls back to the default pack for unknown ids', () => {
    expect(reg.getOrDefault('nope').id).toBe(DEFAULT_PACK_ID);
  });
});

describe('pack validation (untrusted packs)', () => {
  it('rejects unknown fields', () => {
    const p = clone(pastel) as Record<string, unknown>;
    p.css = 'body{}';
    expect(validatePack(p).ok).toBe(false);
  });
  it('rejects markup, CSS or URLs in text', () => {
    for (const bad of ['<b>x</b>', 'url(http://x)', 'a;b', 'javascript:x', 'https://evil']) {
      const p = clone(pastel);
      p.name = bad;
      expect(validatePack(p).ok).toBe(false);
    }
  });
  it('rejects bad colours, fonts and out-of-range numbers', () => {
    const a = clone(pastel); a.palette.ink = 'red';
    const b = clone(pastel); b.fonts.header = 'Comic Sans' as never;
    const c = clone(pastel); c.paper.lineGap = 99;
    for (const p of [a, b, c]) expect(validatePack(p).ok).toBe(false);
  });
  it('fails low-contrast packs', () => {
    const p = clone(pastel);
    p.palette.ink = '#DDDDDD';
    const r = validatePack(p);
    expect(r.ok).toBe(false);
    expect(r.contrast.some((c) => !c.pass)).toBe(true);
  });
});

describe('colour maths', () => {
  it('matches WCAG reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(composite('#FF0000', '#FFFFFF', 0.5)).toBe('#FF8080');
  });
});

describe('theme CSS', () => {
  const pack = createPackRegistry().getOrDefault(DEFAULT_PACK_ID);
  it('contains only variables and static rules, no remote references', () => {
    const css = packCss(pack);
    expect(css).toContain('--paper:#FFFFFF');
    expect(css).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(css).not.toMatch(/javascript:|expression\(|@import/i);
    expect(packVars(pack)['--hl0']).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('fonts', () => {
  it('skips assets that are not valid base64 instead of injecting them', async () => {
    const pack = createPackRegistry().getOrDefault(DEFAULT_PACK_ID);
    let n = 0;
    const faces = await loadFaces(pack, async () => (n++ === 0 ? "');}body{x" : 'AAAA'));
    // Nunito comes from assets (first read is the bad one, skipped); Gaegu is an inline subset (P5).
    const nunito = faces.filter((f) => f.family === 'Nunito');
    expect(nunito).toHaveLength(2);
    expect(nunito.every((f) => f.base64 === 'AAAA')).toBe(true);
    expect(fontFaceCss(faces)).toContain("font-family:'Gaegu'");
  });

  it('loads the default pack\'s Gaegu headers (P5 fix: the full files exceeded the base64 cap)', async () => {
    const pack = createPackRegistry().getOrDefault(DEFAULT_PACK_ID);
    const faces = await loadFaces(pack, async () => 'AAAA');
    const gaegu = faces.filter((f) => f.family === 'Gaegu');
    expect(gaegu.map((f) => f.weight).sort()).toEqual([400, 700]);
    expect(gaegu.every((f) => f.base64.length > 10_000 && f.base64.length < 3_000_000)).toBe(true);
  });
});
