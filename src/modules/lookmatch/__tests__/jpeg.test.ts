/**
 * P5 M2: JPEG metadata stripping ("strip EXIF and location", images are untrusted).
 */
import { base64ToBytes } from '@/core';

import { isJpeg, JpegError, metadataMarkers, stripJpegMetadata } from '../image/jpeg';

import { BASELINE_WITH_METADATA, PROGRESSIVE_WITH_METADATA } from './fixtures/jpegs';

const ascii = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

/** Builds a segment: FF marker, 2-byte length (incl. itself), payload. */
const seg = (marker: number, payload: number[]) => [0xff, marker, ((payload.length + 2) >> 8) & 255, (payload.length + 2) & 255, ...payload];
const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

describe('stripJpegMetadata on real (synthetic) camera-style files', () => {
  it.each([
    ['baseline', BASELINE_WITH_METADATA],
    ['progressive', PROGRESSIVE_WITH_METADATA],
  ])('%s: removes Exif (incl. GPS), XMP and comments, keeps the image data', (_name, b64) => {
    const raw = base64ToBytes(b64);
    // The fixture really carries the metadata we want gone.
    expect(ascii(raw)).toContain('SecretCam');
    expect(ascii(raw)).toContain('Cebu');
    expect(metadataMarkers(raw)).toEqual(expect.arrayContaining([0xe1, 0xfe]));

    const clean = stripJpegMetadata(raw);
    expect(isJpeg(clean)).toBe(true);
    expect(metadataMarkers(clean)).toEqual([]);
    const s = ascii(clean);
    for (const secret of ['SecretCam', 'Model X', 'Cebu', 'Exif', 'xmpmeta', 'Shot at home']) expect(s).not.toContain(secret);
    // Ends with EOI, and stripping again changes nothing (idempotent).
    expect(Array.from(clean.slice(-2))).toEqual([0xff, 0xd9]);
    expect(stripJpegMetadata(clean)).toEqual(clean);
    expect(clean.length).toBeLessThan(raw.length);
  });
});

describe('stripJpegMetadata on hand-built files (edge cases)', () => {
  // SOI, APP0 JFIF, APP13 (IPTC), DQT, SOF0, SOS + scan data with a stuffed FF00 and a
  // restart marker FFD0, then a COMMENT and an APP1 between scans, a second scan, EOI.
  const file = Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, text('JFIF\0')),
    ...seg(0xed, text('Photoshop 3.0 secret')),
    ...seg(0xdb, [0, 1, 2, 3]),
    ...seg(0xc2, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),
    0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56,
    ...seg(0xfe, text('hidden comment')),
    ...seg(0xe1, text('Exif\0\0GPS 14N')),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),
    0x78, 0x9a,
    0xff, 0xd9,
  ]);

  it('removes APPn and COM anywhere, including between progressive scans', () => {
    expect(metadataMarkers(file)).toEqual([0xed, 0xfe, 0xe1]);
    const clean = stripJpegMetadata(file);
    expect(metadataMarkers(clean)).toEqual([]);
    const s = ascii(clean);
    expect(s).toContain('JFIF'); // APP0 kept
    for (const secret of ['Photoshop', 'hidden comment', 'GPS']) expect(s).not.toContain(secret);
    // Scan data (with FF00 stuffing and the restart marker) is copied byte for byte.
    expect(s).toContain(ascii(Uint8Array.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56])));
  });

  it('refuses malformed input instead of guessing', () => {
    expect(() => stripJpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toThrow(JpegError); // PNG
    expect(() => stripJpegMetadata(file.slice(0, 30))).toThrow(JpegError); // truncated
    const badLen = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 0xff, 0xd9]);
    expect(() => stripJpegMetadata(badLen)).toThrow(/segment_past_end/);
    const noEoi = Uint8Array.from([0xff, 0xd8, ...seg(0xe0, [1, 2])]);
    expect(() => stripJpegMetadata(noEoi)).toThrow(/no_eoi/);
  });
});
