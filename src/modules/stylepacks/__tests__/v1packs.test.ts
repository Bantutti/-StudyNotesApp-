/**
 * P5 M1: the 13 v1 packs, their fonts and the font licences.
 * Gate: `npm test` (and `npm run check:fonts` for the generated files).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { BASE64_PATTERN } from '@/core';

import {
  BUNDLED_FACES,
  createPackRegistry,
  DEFAULT_PACK_ID,
  FONT_NOTICES,
  FONTS,
  headerSlot,
  isBuiltInPackId,
  isCustomPackId,
  MAX_FONT_BASE64,
  missingFamilies,
  OFL_TEXT,
  swatchLabel,
  swatchModel,
  V1_PACK_IDS,
  validatePack,
  type StylePack,
} from '../index';

/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS build helpers shared with scripts/ */
const { cmapCodepoints } = require('../../../../scripts/lib/ttfCmap.js') as { cmapCodepoints: (b: Uint8Array) => Set<number> };
const subsetRules = require('../../../../scripts/lib/fontSubset.js') as {
  SUBSET_FACES: { id: string; family: string; source: string }[];
  NEVER_SUBSET: string[];
  subsetText: () => string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const ROOT = join(__dirname, '../../../..');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * Exact pack files. 12 are byte-identical to StudyNotes_StylePacks_v3.zip
 * (SHA-256 b70beabc...2132631, Rey's Nov 1 set); clear-read is P1's approved
 * v2 (4 highlighters). A change here must be deliberate.
 */
const PACK_SHA256: Record<string, string> = {
  'blackout-gel': '6ef0c63f51f0300b5e01f0bc79a8694a008164614ca574fee859413eb6d473d0',
  chalkboard: '54424b003cd7b72b125070e72df707c2317067c04a1aef50eb3b5730f15724a8',
  'clear-read': '3863fa36bd5a5eba1619be14448d3c12aa202bea130b08dcde99bfa1b429d3b2',
  'color-code': 'bb80c2bb5549c299d2b70879c6593683b0e587f673a9db0e22abf2ca45ee5b6b',
  coquette: 'c9e90ae98554905fdfa9aa2d9bd62fa07cb974ddff7b91d18eed5055c5df2b2d',
  cottagecore: '320dc6ad7b20fa05dd384ed1a47ac73baf0d86e89383914d34c2f9a1c6c4bfd7',
  'dark-academia': 'b7d8a70d96641cc89e6f33dbc0e1bf7ac92bb342bc3fa8f3e965839725cfbd52',
  'kawaii-pop': '94f42f3ba28ee432efeeea6cb810bc3c9c34295100affd90298c3890e75e01f9',
  'light-academia': '512b1e6d3e1cb66bb63ab59c786847f489576a1a5c88eec3581db2526a304621',
  'ocean-lines': '3983f6f24a78e79c7135c56af9189752f0f3c913c4016fe527a3991381c7f198',
  'pastel-highlight': '82b044fabbff6f0eb71963158d26f469b8576c43528a6adbd1a0cfa3f5801208',
  'peach-grid': '3a57e0f8458a05a92b982d22200022e1a892b436e6b8a071dcb7f92e60971e41',
  'seoul-minimal': '8277ea3d79eb2e76e4fa88c23e4d32cb7f98c4c5916975c0200d33252597c9f9',
};

describe('v1 pack set (P5 Q1 = A: all 13)', () => {
  const reg = createPackRegistry();

  it('offers all 13 packs in the v1 order, default first, all valid', () => {
    expect(reg.rejected).toEqual([]);
    expect(reg.builtIn().map((p) => p.id)).toEqual([...V1_PACK_IDS]);
    expect(V1_PACK_IDS[0]).toBe(DEFAULT_PACK_ID);
    for (const p of reg.builtIn()) expect(validatePack(p).ok).toBe(true);
  });

  it('pack files are exactly the approved ones (v3 zip, plus Clear Read v2)', () => {
    const dir = join(__dirname, '../packs');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    expect(files.map((f) => f.replace(/\.json$/, ''))).toEqual(Object.keys(PACK_SHA256).sort());
    for (const f of files) expect([f, sha256(readFileSync(join(dir, f)))]).toEqual([f, PACK_SHA256[f.replace(/\.json$/, '')]]);
  });

  it('includes the plan\'s dark Chalkboard pack and the high-legibility Clear Read pack', () => {
    expect(reg.get('chalkboard')?.meta.appearance).toBe('dark');
    expect(reg.get('clear-read')?.fonts.body).toBe('Atkinson Hyperlegible');
  });
});

describe('fonts: every pack renders in its own fonts', () => {
  const reg = createPackRegistry();

  it.each([...V1_PACK_IDS])('%s: header face in the right weight slot and style, and a regular body face', (id) => {
    const p = reg.get(id) as StylePack;
    expect(missingFamilies(p)).toEqual([]);
    const header = BUNDLED_FACES.filter((f) => f.family === p.fonts.header);
    const wantStyle = p.fonts.headerItalic ? 'italic' : 'normal';
    expect(header.some((f) => f.weight === headerSlot(p.fonts.headerWeight) && f.style === wantStyle)).toBe(true);
    expect(BUNDLED_FACES.some((f) => f.family === p.fonts.body && f.weight === 400 && f.style === 'normal')).toBe(true);
  });

  it('every inline subset is valid base64, under the WebView cap, and keeps every wanted character its source has', () => {
    const inline = BUNDLED_FACES.filter((f) => f.source.kind === 'inline');
    expect(inline.map((f) => f.family).sort()).toEqual(['Gaegu', 'Gaegu', 'Gowun Dodum', 'Mochiy Pop One', 'Zen Maru Gothic', 'Zen Maru Gothic']);
    const wanted = [...subsetRules.subsetText()].map((c) => c.codePointAt(0) as number);
    for (const face of subsetRules.SUBSET_FACES) {
      const f = inline.find((x) => x.family === face.family && x.source.kind === 'inline' && (face.id.includes('700') ? x.weight === 700 : x.weight === 400));
      expect(f).toBeDefined();
      const b64 = (f!.source as { base64: string }).base64;
      expect(BASE64_PATTERN.test(b64)).toBe(true);
      expect(b64.length).toBeLessThan(MAX_FONT_BASE64);
      const sub = cmapCodepoints(Buffer.from(b64, 'base64'));
      const src = cmapCodepoints(readFileSync(join(ROOT, 'node_modules', face.source)));
      const lost = wanted.filter((c) => src.has(c) && !sub.has(c));
      expect([face.id, lost]).toEqual([face.id, []]);
      // Letters and digits always (Gaegu's source has no backtick, so not all ASCII).
      for (const ch of 'AZaz09Mm.,?!') expect(sub.has(ch.codePointAt(0) as number)).toBe(true);
    }
  });

  it('every asset face file the app imports is under the WebView cap (as base64)', () => {
    const src = readFileSync(join(__dirname, '../fonts.ts'), 'utf8');
    const imports = [...src.matchAll(/from '@expo-google-fonts\/([a-z-]+)\/([A-Za-z0-9_]+)'/g)];
    expect(imports.length).toBe(BUNDLED_FACES.filter((f) => f.source.kind === 'asset').length);
    for (const [, pkg, dir] of imports) {
      const folder = join(ROOT, 'node_modules/@expo-google-fonts', pkg as string, dir as string);
      const ttf = readdirSync(folder).find((f) => f.endsWith('.ttf')) as string;
      const b64Len = Math.ceil(statSync(join(folder, ttf)).size / 3) * 4;
      expect([ttf, b64Len < MAX_FONT_BASE64]).toEqual([ttf, true]);
    }
  });

  it('never subsets a family with Reserved Font Names', () => {
    for (const f of subsetRules.SUBSET_FACES) expect(subsetRules.NEVER_SUBSET).not.toContain(f.family);
    for (const n of FONT_NOTICES) if (n.reservedNames) expect(n.modified).toBe(false);
  });

  /**
   * Known glyph gaps in the SOURCE fonts (not caused by subsetting): these
   * characters render in the fallback font inside a word. Pinned so a font
   * change that adds or removes a gap is noticed. Reported to the Lead (P5).
   */
  it('known gaps: only Gaegu (headers) and Nanum Gothic (body) lack ñ/Ñ', () => {
    const lacking: string[] = [];
    const families = new Set(BUNDLED_FACES.map((f) => f.family));
    for (const fam of families) {
      const face = BUNDLED_FACES.find((f) => f.family === fam && f.weight === 400) ?? BUNDLED_FACES.find((f) => f.family === fam)!;
      let bytes: Uint8Array;
      if (face.source.kind === 'inline') bytes = Buffer.from(face.source.base64, 'base64');
      else {
        const file = readFileSync(join(__dirname, '../fonts.ts'), 'utf8');
        const pkgDir = new RegExp(`from '@expo-google-fonts/([a-z-]+)/([A-Za-z0-9_]+)'`, 'g');
        const hit = [...file.matchAll(pkgDir)].find(([, pkg]) => pkg === fam.toLowerCase().replace(/ /g, '-'));
        const folder = join(ROOT, 'node_modules/@expo-google-fonts', hit![1] as string, hit![2] as string);
        bytes = readFileSync(join(folder, readdirSync(folder).find((f) => f.endsWith('.ttf')) as string));
      }
      const cps = cmapCodepoints(bytes);
      if (!cps.has(0xf1) || !cps.has(0xd1)) lacking.push(fam);
    }
    expect(lacking.sort()).toEqual(['Gaegu', 'Nanum Gothic']);
  });
});

describe('font licences', () => {
  it('has a notice for every family the schema allows and every bundled family', () => {
    const noticed = new Set(FONT_NOTICES.map((n) => n.family));
    for (const f of FONTS) expect(noticed.has(f)).toBe(true);
    for (const f of BUNDLED_FACES) expect(noticed.has(f.family)).toBe(true);
    expect(OFL_TEXT).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });
  it('marks exactly the subset families as modified', () => {
    expect(FONT_NOTICES.filter((n) => n.modified).map((n) => n.family).sort()).toEqual(['Gaegu', 'Gowun Dodum', 'Mochiy Pop One', 'Zen Maru Gothic']);
  });
});

describe('registry: custom packs (Match a look)', () => {
  const base = createPackRegistry().get('pastel-highlight') as StylePack;
  const custom = (id: string, patch: (p: StylePack) => void = () => {}) => {
    const p = clone(base);
    p.id = id;
    p.name = `Mine ${id.slice(-3)}`;
    p.meta.tier = 'extra';
    patch(p);
    return p;
  };

  it('accepts valid custom packs, lists them after the built-ins and notifies listeners', () => {
    const reg = createPackRegistry();
    const seen: number[] = [];
    reg.subscribe(() => seen.push(reg.revision()));
    const r = reg.setCustom([custom('ref-aaaaaaaaaaaaaaaaaaaa'), custom('ref-bbbbbbbbbbbbbbbbbbbb')]);
    expect(r).toEqual({ accepted: 2, rejected: 0 });
    expect(reg.list().slice(-2).map((p) => p.id)).toEqual(['ref-aaaaaaaaaaaaaaaaaaaa', 'ref-bbbbbbbbbbbbbbbbbbbb']);
    expect(reg.getOrDefault('ref-aaaaaaaaaaaaaaaaaaaa').id).toBe('ref-aaaaaaaaaaaaaaaaaaaa');
    expect(seen).toEqual([1]);
  });

  it('rejects tampered or unsafe custom packs (validated on load, P2a MERGE_NOTES)', () => {
    const reg = createPackRegistry();
    const r = reg.setCustom([
      custom('pastel-highlight'), // shadowing a built-in id
      custom('ref-short'), // wrong id shape
      custom('ref-cccccccccccccccccccc', (p) => (p.palette.ink = p.paper.color)), // contrast fails
      custom('ref-dddddddddddddddddddd', (p) => (p.name = 'x</style><script>')), // markup in text
      { ...custom('ref-eeeeeeeeeeeeeeeeeeee'), extra: 'url(https://evil)' }, // unknown field
      'not a pack',
    ]);
    expect(r).toEqual({ accepted: 0, rejected: 6 });
    expect(reg.get('pastel-highlight')?.name).toBe('Pastel Highlight');
  });

  it('custom ids are recognisable and never collide with built-ins', () => {
    expect(isCustomPackId('ref-abcdefghijklmnopqrst')).toBe(true);
    expect(isCustomPackId('ref-ABCDEFGHIJKLMNOPQRST')).toBe(false);
    for (const id of V1_PACK_IDS) {
      expect(isCustomPackId(id)).toBe(false);
      expect(isBuiltInPackId(id)).toBe(true);
    }
  });
});

describe('swatch model (PackPicker, Q9 = A)', () => {
  const reg = createPackRegistry();
  it('describes each pack with composited highlighters and an accessible label', () => {
    const m = swatchModel(reg.get('chalkboard') as StylePack);
    expect(m.dark).toBe(true);
    expect(m.pattern).toBe('dotted');
    expect(m.highlights).toHaveLength(1);
    expect(m.highlights[0]).not.toBe('#FFDA66'); // shown over the paper at 0.32 opacity
    expect(swatchLabel(m)).toBe('Chalkboard. Dark page. Best for Dark mode and diagrams.');
    for (const p of reg.builtIn()) expect(swatchModel(p).rows).toBeGreaterThan(2);
  });
});
