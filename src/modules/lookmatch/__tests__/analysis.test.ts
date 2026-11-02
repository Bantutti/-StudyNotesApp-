/**
 * P5 M3: the on-device pass on SYNTHETIC pages (MATCH_MATH.md §2-§6).
 * Every built-in pack is drawn as a page (helpers/synthPage, with a phone-
 * style shadow and sensor noise) and analysed. These are generated test
 * images, not photos; real photos are checked in Rey's device test.
 */
import { createPackRegistry, type StylePack } from '@/modules/stylepacks';

import { analyzeImages, analyzeImagesAsync, type LookAnalysis } from '../analysis/analyze';
import { lineGapFromRatio } from '../analysis/pattern';
import { deltaE, hexToLab } from '../color/oklab';

import { synthPage, type SynthSpec } from './helpers/synthPage';

const W = 288;
/** Inverse of §5.4: the spacing (px at width W) that maps back to the pack's lineGap. */
const periodFor = (gap: number) => (0.025 + ((gap - 22) / 12) * 0.035) * W;
const dE = (x: string, y: string) => deltaE(hexToLab(x), hexToLab(y));

function pageOf(p: StylePack, over: Partial<SynthSpec> = {}) {
  return synthPage({
    paper: p.paper.color,
    line: p.paper.line,
    type: p.paper.type,
    period: periodFor(p.paper.lineGap),
    margin: p.paper.margin,
    ink: p.palette.ink,
    accent: p.palette.accent,
    highlighters: p.highlighters.map((h) => ({ color: h.color, opacity: h.opacity })),
    noise: 3,
    shadow: 0.08,
    ...over,
  });
}

const reg = createPackRegistry();
const results = new Map<string, LookAnalysis>(reg.builtIn().map((p) => [p.id, analyzeImages([pageOf(p)])]));

describe('on-device pass recovers each built-in look from a synthetic page', () => {
  it.each(reg.builtIn().map((p) => [p.id, p] as const))('%s: paper type, spacing, margin, light/dark, paper and ink colours', (_id, p) => {
    const a = results.get(p.id)!;
    expect(a.paper.type).toBe(p.paper.type);
    if (p.paper.type === 'plain') expect(a.paper.lineGap).toBeNull();
    else expect(Math.abs((a.paper.lineGap as number) - p.paper.lineGap)).toBeLessThanOrEqual(1);
    expect(a.paper.margin).toBe(p.paper.margin);
    expect(a.appearance).toBe(p.meta.appearance);
    expect(dE(a.paper.color, p.paper.color)).toBeLessThan(0.02); // §1.3: about "just noticeable"
    expect(dE(a.ink, p.palette.ink)).toBeLessThan(0.04);
  });

  it('finds the header colour for most packs, and never takes the margin rule for it', () => {
    const near = reg.builtIn().filter((p) => {
      const acc = results.get(p.id)!.accent;
      return acc !== null && dE(acc, p.palette.accent) < 0.08;
    });
    expect(near.length).toBeGreaterThanOrEqual(10);
    for (const id of ['pastel-highlight', 'ocean-lines', 'coquette']) {
      expect(dE(results.get(id)!.accent!, '#E0607A')).toBeGreaterThan(0.05); // the synthetic margin colour
    }
  });

  it('finds highlighters on most pages, never confusing the ruling or dots with one', () => {
    // Known limit: very pale highlighters (Seoul Minimal, Light Academia, Coquette, Peach Grid,
    // Chalkboard's low-opacity yellow) blend into the paper cluster. Measured: 8 of 13 pages.
    // The builder fills missing highlighters from the nearest pack, and the chip lets the student pick.
    const withHl = reg.builtIn().filter((p) => results.get(p.id)!.highlighters.length > 0);
    expect(withHl.length).toBeGreaterThanOrEqual(8);
    for (const p of reg.builtIn()) {
      const a = results.get(p.id)!;
      // Clusters within 0.05 of the pattern colour are excluded (§4.5). Hex values are gamut-mapped
      // (§1.5), which can pull a vivid pale cluster toward grey, so compare the hexes at 0.025.
      // (Kawaii Pop's sky-blue highlighter is a real one, 0.057 from its grid colour before mapping.)
      if (a.paper.line) for (const h of a.highlighters) expect([p.id, h.seen, dE(h.seen, a.paper.line) > 0.025]).toEqual([p.id, h.seen, true]);
      for (const h of a.highlighters) expect(h.opacity).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('measures the pattern colour (ruling, grid or dots), not the ink', () => {
    for (const p of reg.builtIn().filter((x) => x.paper.type !== 'plain')) {
      const line = results.get(p.id)!.paper.line!;
      expect([p.id, dE(line, p.paper.line) < 0.03]).toEqual([p.id, true]);
    }
  });
});

describe('robustness', () => {
  const pastel = reg.get('pastel-highlight')!;

  it('dense writing on plain paper is not mistaken for ruled lines or dots', () => {
    for (const seed of [1, 2, 3, 4]) {
      const a = analyzeImages([pageOf(pastel, { type: 'plain', margin: 'none', seed })]);
      expect(a.paper.type).toBe('plain');
    }
  });

  it('a strong shadow (25%) and heavier noise still give the right paper type and a near-white paper', () => {
    const a = analyzeImages([pageOf(pastel, { shadow: 0.25, noise: 6 })]);
    expect(a.paper.type).toBe('lined');
    expect(dE(a.paper.color, '#FFFFFF')).toBeLessThan(0.05);
  });

  it('detects texture: noisy light paper is grain, noisy dark paper is chalk, clean paper is none', () => {
    expect(analyzeImages([pageOf(pastel, { noise: 14, type: 'plain', margin: 'none' })]).paper.texture).toBe('grain');
    const chalk = reg.get('chalkboard')!;
    expect(analyzeImages([pageOf(chalk, { noise: 14, type: 'plain' })]).paper.texture).toBe('chalk');
    expect(results.get('pastel-highlight')!.paper.texture).toBe('none');
  });

  it('a blank page gives plain paper and a fallback ink, without throwing', () => {
    const blank = synthPage({ paper: '#FAF7F0', line: '#FAF7F0', type: 'plain', period: 10, ink: '#FAF7F0', accent: '#FAF7F0', textLines: 0, noise: 1 });
    const a = analyzeImages([blank]);
    expect(a.paper.type).toBe('plain');
    expect(hexToLab(a.ink).L).toBeLessThan(0.4);
  });

  it('is deterministic: the same photos always give the same analysis', () => {
    const img = pageOf(reg.get('kawaii-pop')!);
    expect(analyzeImages([img])).toEqual(analyzeImages([img]));
  });
});

describe('multiple photos (§6, Q4 = A)', () => {
  const cotta = reg.get('cottagecore')!;
  it('pattern by vote, with agreement reported', () => {
    const lined = pageOf(cotta, { seed: 1 });
    const lined2 = pageOf(cotta, { seed: 2 });
    const plain = pageOf(cotta, { type: 'plain', seed: 3 });
    const a = analyzeImages([plain, lined, lined2]);
    expect(a.imageCount).toBe(3);
    expect(a.paper.type).toBe('lined');
    expect(a.confidence.agreement).toBeCloseTo(0.67, 2);
  });

  it('each photo counts equally, so a bigger photo cannot outvote the others on colour', () => {
    const cream = pageOf(cotta, { seed: 4 });
    const cream2 = pageOf(cotta, { seed: 5 });
    const big = synthPage({ ...{ paper: '#FFFFFF', line: '#DCE3F0', type: 'lined', period: periodFor(28), ink: '#2F3448', accent: '#B8476F' }, width: 576, height: 768, seed: 6 });
    const a = analyzeImages([big, cream, cream2]);
    expect(dE(a.paper.color, cotta.paper.color)).toBeLessThan(dE(a.paper.color, '#FFFFFF'));
  });

  it('the async version gives the same result, reports progress and can be cancelled', async () => {
    const imgs = [pageOf(cotta, { seed: 7 }), pageOf(cotta, { seed: 8 })];
    const stages: string[] = [];
    const a = await analyzeImagesAsync(imgs, { onProgress: (p) => stages.push(`${p.stage}${p.image}`), yieldFn: async () => {} });
    expect(a).toEqual(analyzeImages(imgs));
    expect(stages).toEqual(['reading1', 'pattern1', 'reading2', 'pattern2', 'palette2', 'done2']);
    const ctl = new AbortController();
    ctl.abort();
    await expect(analyzeImagesAsync(imgs, { signal: ctl.signal, yieldFn: async () => {} })).rejects.toThrow('cancelled');
  });
});

describe('line gap mapping (§5.4)', () => {
  it('maps spacing ratios linearly onto 22..34 and clamps', () => {
    expect(lineGapFromRatio(0.025, 28)).toBe(22);
    expect(lineGapFromRatio(0.06, 28)).toBe(34);
    expect(lineGapFromRatio(0.0425, 28)).toBe(28);
    expect(lineGapFromRatio(0.001, 28)).toBe(22);
    expect(lineGapFromRatio(0.5, 28)).toBe(34);
    expect(lineGapFromRatio(null, 28)).toBe(28);
  });
});
