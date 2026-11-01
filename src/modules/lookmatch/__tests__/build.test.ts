/**
 * P5 M4: pack builder, nearest pack, contrast repair, blend slider, ids
 * (MATCH_MATH.md §7-§9). The key promise: whatever the photo, the output
 * is a pack validatePack accepts.
 */
import { contrast, createPackRegistry, CUSTOM_PACK_ID, isCustomPackId, validatePack, type StylePack } from '@/modules/stylepacks';

import { analyzeImages, type LookAnalysis } from '../analysis/analyze';
import { mulberry32 } from '../analysis/kmeans';
import { blendPacks, blendSteps, BLEND_STEPS } from '../build/blend';
import { buildPack, PackBuildError } from '../build/builder';
import { newCustomPackId } from '../build/ids';
import { rankPacks } from '../build/nearest';
import { nudgeLightness, repairContrast } from '../build/repair';
import { deltaE, hexToLab } from '../color/oklab';

import { synthPage } from './helpers/synthPage';

const reg = createPackRegistry();
const builtIns = reg.builtIn();
const ENTITY_ID = /^[A-Za-z0-9_-]{16,64}$/; // P2a firebase/src/schemas/limits.ts ENTITY_ID_PATTERN
const dE = (x: string, y: string) => deltaE(hexToLab(x), hexToLab(y));

function randomHex(r: () => number): string {
  return `#${Math.floor(r() * 0x1000000).toString(16).padStart(6, '0').toUpperCase()}`;
}

/** A random but well-typed analysis: any colours at all, any pattern. */
function randomAnalysis(r: () => number): LookAnalysis {
  const types = ['lined', 'grid', 'dotted', 'plain'] as const;
  const type = types[Math.floor(r() * 4)] as (typeof types)[number];
  const nHl = Math.floor(r() * 5);
  const paper = randomHex(r);
  return {
    imageCount: 1 + Math.floor(r() * 3),
    appearance: hexToLab(paper).L >= 0.5 ? 'light' : 'dark',
    paper: {
      color: paper,
      line: r() < 0.5 ? randomHex(r) : null,
      type,
      lineGap: type === 'plain' ? null : 22 + Math.floor(r() * 13),
      margin: (['none', 'left', 'double'] as const)[Math.floor(r() * 3)] as 'none',
      marginColor: null,
      texture: (['none', 'grain', 'chalk'] as const)[Math.floor(r() * 3)] as 'none',
    },
    ink: randomHex(r),
    accent: r() < 0.7 ? randomHex(r) : null,
    accent2: r() < 0.4 ? randomHex(r) : null,
    highlighters: Array.from({ length: nHl }, () => ({ color: randomHex(r), opacity: Math.round((0.25 + r() * 0.75) * 100) / 100, seen: randomHex(r), weight: r() * 0.05 })),
    swatches: [],
    confidence: { paperType: r(), agreement: 1 },
  };
}

describe('buildPack always produces a valid pack (fuzz, §8)', () => {
  it('1,000 random analyses x random nearest packs -> validatePack ok, ids and names kept', () => {
    const r = mulberry32(20261101);
    for (let i = 0; i < 1000; i++) {
      const a = randomAnalysis(r);
      const base = builtIns[Math.floor(r() * builtIns.length)] as StylePack;
      const id = newCustomPackId((n) => Uint8Array.from({ length: n }, () => Math.floor(r() * 256)));
      const p = buildPack({ id, name: `My look ${i}`, analysis: a, base });
      const report = validatePack(p);
      expect(report.ok).toBe(true);
      expect(p.id).toBe(id);
      expect(p.meta.tier).toBe('extra');
      // Repair keeps colours as close as it can: paper is never changed.
      expect(p.paper.color).toBe(a.paper.color);
    }
  });

  it('refuses unsafe names through the validator (no markup, CSS or URLs, ever)', () => {
    const a = randomAnalysis(mulberry32(1));
    for (const name of ['</style><script>x', 'a{b}', 'see https://x.y', 'x; y', 'url(x)']) {
      expect(() => buildPack({ id: 'ref-aaaaaaaaaaaaaaaaaaaa', name, analysis: a, base: builtIns[0]! })).toThrow(PackBuildError);
    }
  });
});

describe('contrast repair (§8)', () => {
  it('nudges lightness just enough, keeping the hue', () => {
    const fixed = nudgeLightness('#FFB6D9', '#FFFFFF', 3); // a pale pink accent on white
    expect(contrast(fixed, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrast(fixed, '#FFFFFF')).toBeLessThan(3.4); // minimal, not "make it black"
    const h = (x: string) => Math.atan2(hexToLab(x).b, hexToLab(x).a);
    expect(Math.abs(h(fixed) - h('#FFB6D9'))).toBeLessThan(0.15);
    expect(nudgeLightness('#222222', '#FFFFFF', 4.5)).toBe('#222222'); // already passing: unchanged
  });

  it('fixes a pathological pack (ink = paper, highlighter = ink) in the right order', () => {
    const p: StylePack = JSON.parse(JSON.stringify(reg.get('pastel-highlight'))) as StylePack;
    p.palette.ink = p.paper.color;
    p.palette.soft = '#000000';
    p.highlighters[0]!.color = '#2F3448';
    p.highlighters[0]!.opacity = 1;
    expect(validatePack(p).ok).toBe(false);
    expect(validatePack(repairContrast(p)).ok).toBe(true);
  });
});

describe('nearest pack (§7): synthetic round trip', () => {
  it('a synthetic page drawn in pack X has X as its nearest built-in pack, for at least 12 of 13 packs', () => {
    const misses: string[] = [];
    for (const p of builtIns) {
      const img = synthPage({
        paper: p.paper.color,
        line: p.paper.line,
        type: p.paper.type,
        period: (0.025 + ((p.paper.lineGap - 22) / 12) * 0.035) * 288,
        margin: p.paper.margin,
        ink: p.palette.ink,
        accent: p.palette.accent,
        highlighters: p.highlighters.map((h) => ({ color: h.color, opacity: h.opacity })),
        noise: 3,
        shadow: 0.08,
      });
      const nearest = rankPacks(analyzeImages([img]), builtIns)[0]!.pack.id;
      if (nearest !== p.id) misses.push(`${p.id}->${nearest}`);
    }
    expect(misses.length).toBeLessThanOrEqual(1);
  });

  it('a matched pack keeps what the photo showed and takes the rest from the nearest pack', () => {
    const base = reg.get('cottagecore')!;
    const img = synthPage({ paper: '#FBF6E9', line: '#E9DFC4', type: 'lined', period: 12, ink: '#4A3F31', accent: '#2D5BD7', noise: 2 });
    const a = analyzeImages([img]);
    const p = buildPack({ id: 'ref-bbbbbbbbbbbbbbbbbbbb', name: 'Blue cottage', analysis: a, base });
    expect(p.paper.type).toBe('lined');
    expect(dE(p.palette.accent, '#2D5BD7')).toBeLessThan(0.08); // the photo's blue header, not Cottagecore's green
    expect(p.fonts).toEqual(base.fonts);
    expect(p.header).toEqual(base.header);
    expect(p.decor).toEqual(base.decor);
  });

  it('chip choices win over the analysis, and highlighters can be dropped', () => {
    const a = randomAnalysis(mulberry32(5));
    a.highlighters = [
      { color: '#FFB6D9', opacity: 0.6, seen: '#FFD3E8', weight: 0.02 },
      { color: '#BFE6D2', opacity: 0.6, seen: '#D9F0E4', weight: 0.02 },
    ];
    a.paper.color = '#FFFFFF';
    a.appearance = 'light';
    const base = reg.get('color-code')!;
    const p = buildPack({ id: 'ref-cccccccccccccccccccc', name: 'Mine', analysis: a, base, choices: { paperType: 'grid', headerStyle: 'washi-tape', fonts: reg.get('light-academia')!.fonts, keepHighlighters: [false, true] } });
    expect(p.paper.type).toBe('grid');
    expect(p.header.style).toBe('washi-tape');
    expect(p.fonts.header).toBe('Cormorant Garamond');
    expect(p.highlighters).toHaveLength(1);
    expect(p.highlighters[0]!.meaning).toBe(base.highlighters[0]!.meaning);
  });
});

describe('blend slider (§9, Q6 = A)', () => {
  const a = analyzeImages([synthPage({ paper: '#FFF7E8', line: '#E3D9C2', type: 'lined', period: 12, ink: '#3B2F2F', accent: '#2D7D9A', noise: 2 })]);
  const target = rankPacks(a, builtIns)[0]!.pack;
  const matched = buildPack({ id: 'ref-dddddddddddddddddddd', name: 'Match', analysis: a, base: target });

  it(`has ${BLEND_STEPS} steps, every one a valid pack with the same id and name`, () => {
    const steps = blendSteps(matched, target);
    expect(steps).toHaveLength(11);
    for (const s of steps) {
      expect(validatePack(s).ok).toBe(true);
      expect([s.id, s.name]).toEqual([matched.id, matched.name]);
    }
  });

  it('starts at the matched look and ends at the target look', () => {
    expect(blendPacks(matched, target, 0)).toEqual(matched);
    const end = blendPacks(matched, target, 1);
    expect(end.paper.color).toBe(target.paper.color);
    expect(end.palette.ink).toBe(target.palette.ink);
    expect(end.fonts).toEqual(target.fonts);
    expect(end.highlighters.map((h) => h.color)).toEqual(target.highlighters.map((h) => h.color));
  });

  it('moves colours gradually and switches choices at the midpoint', () => {
    const d = (t: number) => dE(blendPacks(matched, target, t).palette.accent, target.palette.accent);
    expect(d(0)).toBeGreaterThan(d(0.5));
    expect(d(0.5)).toBeGreaterThan(d(0.9));
    expect(blendPacks(matched, target, 0.4).header.style).toBe(matched.header.style);
    expect(blendPacks(matched, target, 0.5).header.style).toBe(target.header.style);
  });

  it('clamps out-of-range and NaN positions', () => {
    expect(blendPacks(matched, target, -3)).toEqual(matched);
    expect(blendPacks(matched, target, Number.NaN)).toEqual(matched);
    expect(blendPacks(matched, target, 7).paper.color).toBe(target.paper.color);
  });
});

describe('custom pack ids', () => {
  it('are valid pack ids, custom ids and P2a entity ids, with no collisions in 10,000', () => {
    const seen = new Set<string>();
    const r = mulberry32(99);
    for (let i = 0; i < 10_000; i++) {
      const id = newCustomPackId((n) => Uint8Array.from({ length: n }, () => Math.floor(r() * 256)));
      expect(CUSTOM_PACK_ID.test(id) && isCustomPackId(id) && ENTITY_ID.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
  it('uses all 100 random bits (all-zero and all-one inputs differ in every character)', () => {
    expect(newCustomPackId((n) => new Uint8Array(n))).toBe('ref-aaaaaaaaaaaaaaaaaaaa');
    expect(newCustomPackId((n) => new Uint8Array(n).fill(255))).toBe('ref-77777777777777777777');
  });
});
