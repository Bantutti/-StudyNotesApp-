/**
 * JPEG metadata stripping (P5 security: "strip EXIF and location").
 *
 * Every reference photo is first RE-ENCODED by expo-image-manipulator (new
 * pixels, new file), which normally drops the camera's metadata. We don't
 * rely on that alone: this parser walks the re-encoded JPEG and removes
 * every metadata segment, then a test proves none survive.
 *
 * Removed: APP1..APP15 (0xFFE1-0xFFEF: Exif with GPS location, XMP, ICC
 * profiles, IPTC/Photoshop, Adobe, MPF...) and COM (0xFFFE: free-text
 * comments). Kept: APP0 (JFIF header, no personal data) and every segment
 * needed to decode the image (DQT, DHT, SOFn, DRI, SOS and scan data).
 *
 * JPEG structure (ITU T.81, Annex B): SOI (FFD8), then segments. Each
 * segment is FF + marker byte, then (for most markers) a 2-byte big-endian
 * length that INCLUDES those 2 bytes. After SOS the entropy-coded scan data
 * follows; inside it a literal 0xFF is written as FF 00, and FF D0..D7 are
 * restart markers, so the scan ends at the first FF followed by any other
 * byte. Progressive JPEGs have several scans, so parsing continues after
 * each one (metadata could also hide between scans).
 * Every read is bounds-checked; malformed input throws, it is never "fixed".
 */

export class JpegError extends Error {
  constructor(reason: string) {
    super(`bad_jpeg:${reason}`);
    this.name = 'JpegError';
  }
}

const isApp = (m: number) => m >= 0xe0 && m <= 0xef;
const isMetadata = (m: number) => (m >= 0xe1 && m <= 0xef) || m === 0xfe;
/** Markers with no length field: TEM (01) and RST0..7 (D0..D7). SOI/EOI are handled separately. */
const isStandalone = (m: number) => m === 0x01 || (m >= 0xd0 && m <= 0xd7);

export function isJpeg(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** Visits every segment. `onSegment(marker, start, end)` covers marker bytes through the segment's last byte. */
function walk(b: Uint8Array, onSegment: (marker: number, start: number, end: number) => void): void {
  if (!isJpeg(b)) throw new JpegError('no_soi');
  let i = 2;
  for (;;) {
    if (i >= b.length) throw new JpegError('no_eoi');
    if (b[i] !== 0xff) throw new JpegError('expected_marker');
    // Fill bytes: any number of extra 0xFF before a marker are allowed (T.81 B.1.1.2).
    let j = i + 1;
    while (j < b.length && b[j] === 0xff) j++;
    if (j >= b.length) throw new JpegError('truncated_marker');
    const m = b[j] as number;
    if (m === 0x00) throw new JpegError('stuffed_byte_outside_scan');
    if (m === 0xd9) {
      onSegment(m, i, j + 1); // EOI: done
      return;
    }
    if (isStandalone(m)) {
      onSegment(m, i, j + 1);
      i = j + 1;
      continue;
    }
    if (j + 2 >= b.length) throw new JpegError('truncated_length');
    const len = ((b[j + 1] as number) << 8) | (b[j + 2] as number);
    if (len < 2) throw new JpegError('bad_length');
    let end = j + 1 + len; // first byte after the segment
    if (end > b.length) throw new JpegError('segment_past_end');
    if (m === 0xda) {
      // SOS: skip the entropy-coded data up to the next real marker.
      let k = end;
      for (;;) {
        if (k + 1 >= b.length) throw new JpegError('scan_past_end');
        if (b[k] === 0xff) {
          const n = b[k + 1] as number;
          if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7) && n !== 0xff) break;
        }
        k++;
      }
      end = k;
    }
    onSegment(m, i, end);
    i = end;
  }
}

/** Returns a copy of `jpeg` without APP1..APP15 and COM segments. Throws JpegError on malformed input. */
export function stripJpegMetadata(jpeg: Uint8Array): Uint8Array {
  const keep: [number, number][] = [[0, 2]]; // SOI
  walk(jpeg, (m, s, e) => {
    if (!isMetadata(m)) keep.push([s, e]);
  });
  const size = keep.reduce((n, [s, e]) => n + (e - s), 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const [s, e] of keep) {
    out.set(jpeg.subarray(s, e), o);
    o += e - s;
  }
  return out;
}

/** Metadata markers still present (for tests and a defensive check after stripping). */
export function metadataMarkers(jpeg: Uint8Array): number[] {
  const found: number[] = [];
  walk(jpeg, (m) => {
    if (isMetadata(m) || (isApp(m) && m !== 0xe0)) found.push(m);
  });
  return found;
}
