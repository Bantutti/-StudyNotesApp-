/**
 * Every font face the shipped packs need (all 13 v1 packs since P5) is actually
 * loaded from the real bundled TTF files or Latin subsets, and fits the editor
 * bridge. Before P1 PR #9 Gaegu (Pastel's header font, ~4.2 M base64 chars)
 * exceeded MAX_FONT_BASE64 and was skipped silently; P5 ships it as a subset.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { encode, MAX_BRIDGE_CHARS, toWebSchema, decode } from '@/modules/editor';

import { BUNDLED_FACES, createPackRegistry, facesForPack, loadFaces, MAX_FONT_BASE64, V1_PACK_IDS, type AssetReader, type FaceSkip } from '../index';

const root = join(__dirname, '..', '..', '..', '..');

/**
 * The real TTF behind each ASSET face, read from fonts.ts itself (P5): each row
 * `asset('Family', weight, 'style', Ident)` plus the import line of `Ident`
 * gives the package file. Inline faces (Latin subsets) carry their data and
 * are never read through the reader.
 */
const FONTS_TS = readFileSync(join(__dirname, '..', 'fonts.ts'), 'utf8');
const IMPORTS = new Map([...FONTS_TS.matchAll(/import \{ (\w+) \} from '@expo-google-fonts\/([a-z-]+)\/(\w+)';/g)].map((m) => [m[1]!, [m[2]!, m[3]!] as const]));
const ASSET_FILES = new Map(
  [...FONTS_TS.matchAll(/asset\('([^']+)', (400|700), '(normal|italic)', (\w+)\)/g)].map((m) => {
    const [pkg, dir] = IMPORTS.get(m[4]!)!;
    return [`${m[1]} ${m[2]} ${m[3]}`, join(root, 'node_modules', '@expo-google-fonts', pkg, dir, `${m[4]}.ttf`)] as const;
  }),
);
const fileOf = (f: (typeof BUNDLED_FACES)[number]) => ASSET_FILES.get(`${f.family} ${f.weight} ${f.style}`)!;

/**
 * Reads the real files in the order loadFaces asks for them (facesForPack order, asset faces
 * only). Under Jest every TTF import resolves to the same asset id, so the asset number can't
 * identify the file.
 */
function realReader(pack: Parameters<typeof facesForPack>[0]): AssetReader {
  const queue = facesForPack(pack).filter((f) => f.source.kind === 'asset').map(fileOf);
  return async () => readFileSync(queue.shift()!).toString('base64');
}

describe('shipped packs load all their font faces', () => {
  const packs = createPackRegistry();

  it.each([...V1_PACK_IDS])('%s: every required face is loaded (none skipped)', async (id) => {
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

  it('every asset row maps to a real file, and every shipped face fits under the cap and in ONE bridge message', async () => {
    expect(ASSET_FILES.size).toBe(BUNDLED_FACES.filter((f) => f.source.kind === 'asset').length);
    let largest = 0;
    for (const id of V1_PACK_IDS) {
      const pack = packs.get(id)!;
      const faces = await loadFaces(pack, realReader(pack));
      for (const f of faces) {
        largest = Math.max(largest, f.base64.length);
        const raw = encode({ v: 1, type: 'setFonts', faces: [f], append: true });
        expect(raw.length).toBeLessThanOrEqual(MAX_BRIDGE_CHARS);
        expect(decode(raw, toWebSchema).ok).toBe(true);
      }
    }
    // Nanum Gothic Bold (2,763,184 chars, Reserved Font Names so never subset) is the largest face.
    expect(largest).toBe(2_763_184);
    expect(largest).toBeLessThan(MAX_FONT_BASE64 * 0.95);
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
