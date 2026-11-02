/**
 * P5 M3: OKLab colour maths (MATCH_MATH.md §1) and k-means (§3).
 */
import { kmeans, mergeClose, mulberry32 } from '../analysis/kmeans';
import { chroma, deltaE, gamutMap, hexToLab, hue, labToHex, mixHexOklab, rgbaToLabInto, rgbToLab } from '../color/oklab';

describe('OKLab (§1)', () => {
  it('matches the published reference values (Ottosson 2020)', () => {
    const white = hexToLab('#FFFFFF');
    expect(white.L).toBeCloseTo(1, 4);
    expect(Math.abs(white.a) + Math.abs(white.b)).toBeLessThan(1e-4);
    expect(hexToLab('#000000').L).toBeCloseTo(0, 6);
    const red = hexToLab('#FF0000'); // sRGB red: L 0.62796, a 0.22486, b 0.12585
    expect(red.L).toBeCloseTo(0.62796, 4);
    expect(red.a).toBeCloseTo(0.22486, 4);
    expect(red.b).toBeCloseTo(0.12585, 4);
  });

  it('round-trips every hex colour exactly (sampled)', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 2000; i++) {
      const hex = `#${Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
      expect(labToHex(hexToLab(hex))).toBe(hex);
    }
  });

  it('the bulk converter equals the per-pixel one', () => {
    const data = Uint8Array.from([255, 0, 0, 255, 12, 200, 99, 255, 247, 241, 230, 255]);
    const out = new Float64Array(9);
    rgbaToLabInto(data, 3, out);
    [rgbToLab(255, 0, 0), rgbToLab(12, 200, 99), rgbToLab(247, 241, 230)].forEach((c, i) => {
      expect(out[i * 3]).toBeCloseTo(c.L, 12);
      expect(out[i * 3 + 1]).toBeCloseTo(c.a, 12);
      expect(out[i * 3 + 2]).toBeCloseTo(c.b, 12);
    });
  });

  it('gamut mapping reduces chroma but keeps lightness and hue (§1.5)', () => {
    const vivid = { L: 0.7, a: 0.35, b: -0.05 }; // far outside sRGB
    const rgb = gamutMap(vivid);
    expect(rgb.every((v) => v >= -0.5 && v <= 255.5)).toBe(true);
    const back = rgbToLab(...(rgb.map((v) => Math.round(Math.min(255, Math.max(0, v)))) as [number, number, number]));
    expect(back.L).toBeCloseTo(0.7, 1);
    expect(Math.abs(hue(back) - hue(vivid))).toBeLessThan(3);
    expect(chroma(back)).toBeLessThan(chroma(vivid));
  });

  it('blends in OKLab (§9.1): the midpoint of black and white is a perceptual mid grey', () => {
    expect(mixHexOklab('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mixHexOklab('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(hexToLab(mixHexOklab('#000000', '#FFFFFF', 0.5)).L).toBeCloseTo(0.5, 2);
    expect(deltaE(hexToLab('#FFFFFF'), hexToLab('#FEFEFE'))).toBeLessThan(0.01);
  });
});

describe('k-means (§3)', () => {
  const blob = (c: { L: number; a: number; b: number }, n: number, spread: number, rand: () => number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(c.L + (rand() - 0.5) * spread, c.a + (rand() - 0.5) * spread, c.b + (rand() - 0.5) * spread);
    return out;
  };

  it('finds well-separated colours with their shares, deterministically', () => {
    const rand = mulberry32(1);
    const samples = Float64Array.from([
      ...blob(hexToLab('#FFFFFF'), 800, 0.01, rand),
      ...blob(hexToLab('#222233'), 150, 0.01, rand),
      ...blob(hexToLab('#FFB6D9'), 50, 0.01, rand),
    ]);
    const a = kmeans(samples, { k: 6, seed: 9 });
    const b = kmeans(samples, { k: 6, seed: 9 });
    expect(a).toEqual(b); // same seed, same result
    expect(a.map((c) => Math.round(c.weight * 100))).toEqual([80, 15, 5]); // near-duplicates merged (§3.3)
    expect(deltaE(a[0]!.center, hexToLab('#FFFFFF'))).toBeLessThan(0.01);
    expect(deltaE(a[2]!.center, hexToLab('#FFB6D9'))).toBeLessThan(0.01);
  });

  it('handles fewer distinct samples than k, and empty input', () => {
    const one = Float64Array.from([0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 0]);
    expect(kmeans(one, { k: 8, seed: 1 })).toEqual([{ center: { L: 0.5, a: 0, b: 0 }, weight: 1 }]);
    expect(kmeans(new Float64Array(0), { k: 8, seed: 1 })).toEqual([]);
  });

  it('merges clusters closer than the threshold into a weighted centre', () => {
    const m = mergeClose(
      [
        { center: { L: 0.9, a: 0, b: 0 }, weight: 0.6 },
        { center: { L: 0.91, a: 0, b: 0 }, weight: 0.2 },
        { center: { L: 0.3, a: 0, b: 0 }, weight: 0.2 },
      ],
      0.03,
    );
    expect(m).toHaveLength(2);
    expect(m[0]!.weight).toBeCloseTo(0.8, 10);
    expect(m[0]!.center.L).toBeCloseTo(0.9025, 10);
  });
});
