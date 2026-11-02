/**
 * P5 M2: reference image intake with fake platform ports.
 */
import { base64ToBytes } from '@/core';

import { checkPicked, intakeImages, intakeMessage, IntakeError, type ImageIntakePorts, type PickedImage } from '../image/intake';
import { metadataMarkers } from '../image/jpeg';
import { ANALYSIS_LONG_SIDE, MAX_INPUT_BYTES, VISION_LONG_SIDE } from '../image/limits';

import { BASELINE_WITH_METADATA } from './fixtures/jpegs';

const photo = (i: number, patch: Partial<PickedImage> = {}): PickedImage => ({
  uri: `file:///cache/ImagePicker/p${i}.jpg`,
  width: 4000,
  height: 3000,
  fileSize: 4_000_000,
  mimeType: 'image/jpeg',
  type: 'image',
  ...patch,
});

/** Fake ports: the "encoder" returns the metadata-laden fixture, so cleaning is exercised. */
function fakePorts(over: Partial<ImageIntakePorts> = {}) {
  const removed: string[] = [];
  const encoded: { uri: string; longSide: number }[] = [];
  const decodedInputs: string[] = [];
  let n = 0;
  const ports: ImageIntakePorts = {
    async encodeCopy(uri, _src, longSide) {
      const out = `file:///cache/ImageManipulator/m${++n}.jpg`;
      encoded.push({ uri, longSide });
      return { uri: out, width: longSide, height: Math.round(longSide * 0.75), base64: BASELINE_WITH_METADATA };
    },
    decodeJpeg(b64) {
      decodedInputs.push(b64);
      return { width: ANALYSIS_LONG_SIDE, height: 288, data: new Uint8Array(ANALYSIS_LONG_SIDE * 288 * 4) };
    },
    async removeTemp(uri) {
      removed.push(uri);
    },
    ...over,
  };
  return { ports, removed, encoded, decodedInputs };
}

describe('checkPicked (before any decoding)', () => {
  it('accepts 1 to 3 photos', () => {
    expect(checkPicked([photo(1)])).toBeNull();
    expect(checkPicked([photo(1), photo(2), photo(3)])).toBeNull();
  });
  it.each<[string, PickedImage[], string, number | null]>([
    ['none', [], 'too_many', null],
    ['four', [photo(1), photo(2), photo(3), photo(4)], 'too_many', null],
    ['a video', [photo(1, { type: 'video' })], 'not_image', 0],
    ['a GIF', [photo(1), photo(2, { mimeType: 'image/gif' })], 'not_image', 1],
    ['an SVG', [photo(1, { mimeType: 'image/svg+xml' })], 'not_image', 0],
    ['too big a file', [photo(1, { fileSize: MAX_INPUT_BYTES + 1 })], 'too_large', 0],
    ['a decompression bomb (tiny file, 60 MP)', [photo(1, { fileSize: 50_000, width: 10_000, height: 6_000 })], 'too_many_pixels', 0],
    ['too small', [photo(1, { width: 40, height: 600 })], 'too_small', 0],
    ['no dimensions', [photo(1, { width: Number.NaN })], 'unreadable', 0],
  ])('refuses %s', (_n, list, problem, index) => {
    const e = checkPicked(list);
    expect(e).toBeInstanceOf(IntakeError);
    expect([e!.problem, e!.index]).toEqual([problem, index]);
  });
  it('allows an unknown file size (some Android providers) because the pixel cap still applies', () => {
    expect(checkPicked([photo(1, { fileSize: null })])).toBeNull();
  });
});

describe('intakeImages', () => {
  it('re-encodes a small analysis copy, strips metadata before decoding, and deletes every temp file and the picker copies', async () => {
    const f = fakePorts();
    const out = await intakeImages([photo(1), photo(2)], f.ports, { vision: false });
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.visionJpegBase64 === null)).toBe(true);
    expect(f.encoded.map((e) => e.longSide)).toEqual([ANALYSIS_LONG_SIDE, ANALYSIS_LONG_SIDE]);
    // The decoder only ever saw clean JPEGs.
    for (const b64 of f.decodedInputs) expect(metadataMarkers(base64ToBytes(b64))).toEqual([]);
    expect(f.removed.sort()).toEqual(
      ['file:///cache/ImageManipulator/m1.jpg', 'file:///cache/ImageManipulator/m2.jpg', 'file:///cache/ImagePicker/p1.jpg', 'file:///cache/ImagePicker/p2.jpg'].sort(),
    );
  });

  it('makes a clean vision copy only when asked', async () => {
    const f = fakePorts();
    const [r] = await intakeImages([photo(1)], f.ports, { vision: true });
    expect(f.encoded.map((e) => e.longSide)).toEqual([ANALYSIS_LONG_SIDE, VISION_LONG_SIDE]);
    expect(metadataMarkers(base64ToBytes(r!.visionJpegBase64!))).toEqual([]);
    expect(f.removed).toHaveLength(3);
  });

  it('cleans up even when an image fails, and reports which image without leaking decoder text', async () => {
    let calls = 0;
    const f = fakePorts({
      decodeJpeg() {
        calls++;
        if (calls === 2) throw new Error('decode failed at /data/user/0/secret/path.jpg');
        return { width: ANALYSIS_LONG_SIDE, height: 288, data: new Uint8Array(ANALYSIS_LONG_SIDE * 288 * 4) };
      },
    });
    const err = await intakeImages([photo(1), photo(2), photo(3)], f.ports, { vision: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntakeError);
    expect([(err as IntakeError).problem, (err as IntakeError).index]).toEqual(['unreadable', 1]);
    expect((err as IntakeError).message).not.toContain('secret');
    expect(intakeMessage(err as IntakeError)).toBe("Photo 2 couldn't be read. Try another photo.");
    // Both encoder outputs made so far and all three picker copies are deleted.
    expect(f.removed).toHaveLength(5);
  });

  it('refuses a decoder result larger than requested (hostile file or decoder bug)', async () => {
    const f = fakePorts({ decodeJpeg: () => ({ width: 5000, height: 10, data: new Uint8Array(5000 * 10 * 4) }) });
    await expect(intakeImages([photo(1)], f.ports, { vision: false })).rejects.toMatchObject({ problem: 'unreadable', index: 0 });
  });

  it('refuses an encoder result that is not a JPEG', async () => {
    const f = fakePorts({ encodeCopy: async () => ({ uri: 'file:///cache/x.png', width: 10, height: 10, base64: 'iVBORw0KGgo=' }) });
    await expect(intakeImages([photo(1)], f.ports, { vision: false })).rejects.toMatchObject({ problem: 'unreadable' });
    expect(f.removed).toContain('file:///cache/ImagePicker/p1.jpg');
  });

  it('refuses a selection before touching any file', async () => {
    const f = fakePorts();
    await expect(intakeImages([photo(1, { type: 'video' })], f.ports, { vision: false })).rejects.toMatchObject({ problem: 'not_image' });
    expect(f.encoded).toEqual([]);
  });
});
