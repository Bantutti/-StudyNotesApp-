/**
 * Every font face the shipped packs need (Pastel Highlight, the default, and
 * Clear Read) is actually loaded from the real bundled TTF files, and fits
 * the editor bridge. Before the fix Gaegu (Pastel's header font, ~4.2 M
 * base64 chars) exceeded MAX_FONT_BASE64 and was skipped silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { encode, MAX_BRIDGE_CHARS, toWebSchema, decode } from '@/modules/editor';

import { BUNDLED_FACES, createPackRegistry, facesForPack, loadFaces, MAX_FONT_BASE64, P1_PACK_IDS, type AssetReader, type FaceSkip } from '../index';

const root = join(__dirname, '..', '..', '..', '..');
const SLUG: Record<string, string> = {
  Gaegu: 'gaegu',
  Nunito: 'nunito',
  Cinzel: 'cinzel',
  'Crimson Pro': 'crimson-pro',
  'Atkinson Hyperlegible': 'atkinson-hyperlegible',
};

/** The real TTF behind each bundled face, read from node_modules as base64. */
const fileOf = (f: (typeof BUNDLED_FACES)[number]) => {
  const variant = `${f.weight}${f.weight === 700 ? 'Bold' : 'Regular'}${f.style === 'italic' ? '_Italic' : ''}`;
  const name = `${f.family.replace(/ /g, '')}_${variant}.ttf`;
  return join(root, 'node_modules', '@expo-google-fonts', SLUG[f.family]!, variant, name);
};
/**
 * Reads the real files in the order loadFaces asks for them (facesForPack order). Under Jest every
 * TTF import resolves to the same asset id, so the asset number can't identify the file.
 */
function realReader(pack: Parameters<typeof facesForPack>[0]): AssetReader {
  const queue = facesForPack(pack).map(fileOf);
  return async () => readFileSync(queue.shift()!).toString('base64');
}

describe('shipped packs load all their font faces', () => {
  const packs = createPackRegistry();

  it.each(P1_PACK_IDS)('%s: every required face is loaded (none skipped)', async (id) => {
    const pack = packs.get(id)!;
    const skipped: FaceSkip[] = [];
    const faces = await loadFaces(pack, realReader(pack), (s) => skipped.push(s));
    expect(skipped).toEqual([]);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.map((f) => `${f.family} ${f.weight} ${f.style}`).sort()).toEqual(
      facesForPack(pack).map((f) => `${f.family} ${f.weight} ${f.style}`).sort(),
    );
    expect(faces.every((f) => f.base64.length <= MAX_FONT_BASE64)).toBe(true);
  });

  it('the largest shipped face fits under the cap with headroom, and in ONE bridge message', async () => {
    const pack = packs.get('pastel-highlight')!;
    const faces = await loadFaces(pack, realReader(pack));
    const largest = Math.max(...faces.map((f) => f.base64.length));
    expect(largest).toBeLessThan(MAX_FONT_BASE64 * 0.95);
    for (const f of faces) {
      const raw = encode({ v: 1, type: 'setFonts', faces: [f], append: true });
      expect(raw.length).toBeLessThanOrEqual(MAX_BRIDGE_CHARS);
      expect(decode(raw, toWebSchema).ok).toBe(true);
    }
    // All of Pastel's faces together would NOT fit one message: they must be sent one per message.
    expect(encode({ v: 1, type: 'setFonts', faces }).length).toBeGreaterThan(MAX_BRIDGE_CHARS);
  });

  it('an oversized or malformed face is reported (family, weight, reason, size; never its data), not dropped silently', async () => {
    const pack = packs.get('clear-read')!;
    const skipped: FaceSkip[] = [];
    let n = 0;
    const reader: AssetReader = async () => (n++ === 0 ? 'A'.repeat(MAX_FONT_BASE64 + 4) : n === 2 ? 'not base64!' : 'AAAA');
    const faces = await loadFaces(pack, reader, (s) => skipped.push(s));
    expect(faces).toHaveLength(facesForPack(pack).length - 2);
    expect(skipped.map((s) => s.reason)).toEqual(['too_large', 'not_base64']);
    expect(skipped[0]).toMatchObject({ family: 'Atkinson Hyperlegible', chars: MAX_FONT_BASE64 + 4 });
    expect(JSON.stringify(skipped)).not.toMatch(/AAAAAAAA|not base64/);
  });
});
