/**
 * Minimal TrueType/OpenType 'cmap' reader: which Unicode codepoints a font
 * has glyphs for. Used to prove that every font subset still covers the
 * required characters (scripts/lib/fontSubset.js REQUIRED_TEXT).
 *
 * Reads only what it needs, with bounds checks on every read (the input is
 * our own build output, but a parser should never trust offsets):
 *   - table directory (sfnt header) -> the 'cmap' table offset
 *   - cmap encoding records -> a Unicode subtable (platform 3 / encoding 1 or 10, or platform 0)
 *   - subtable format 4 (BMP segments) or format 12 (groups, full Unicode)
 * Format 4 glyph lookups through idRangeOffset are resolved, so a codepoint
 * that maps to glyph 0 (".notdef", i.e. missing) is not counted.
 * Reference: Microsoft OpenType spec, "cmap — Character to Glyph Index Mapping Table".
 */
'use strict';

function reader(buf) {
  const need = (off, n) => {
    if (off < 0 || off + n > buf.length) throw new Error('cmap_out_of_bounds');
  };
  return {
    u16: (o) => (need(o, 2), (buf[o] << 8) | buf[o + 1]),
    i16: (o) => {
      need(o, 2);
      const v = (buf[o] << 8) | buf[o + 1];
      return v & 0x8000 ? v - 0x10000 : v;
    },
    u32: (o) => (need(o, 4), ((buf[o] << 24) >>> 0) + ((buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3])),
    tag: (o) => (need(o, 4), String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])),
  };
}

/** Returns a Set of codepoints that map to a real glyph. `buf` is a Uint8Array or Buffer. */
function cmapCodepoints(buf) {
  const r = reader(buf);
  const numTables = r.u16(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (r.tag(rec) === 'cmap') cmap = r.u32(rec + 8);
  }
  if (cmap < 0) throw new Error('no_cmap');
  const nSub = r.u16(cmap + 2);
  let best = -1;
  let bestRank = -1;
  for (let i = 0; i < nSub; i++) {
    const rec = cmap + 4 + i * 8;
    const pid = r.u16(rec);
    const eid = r.u16(rec + 2);
    const off = cmap + r.u32(rec + 4);
    const fmt = r.u16(off);
    // Prefer full-Unicode format 12, then BMP format 4.
    const rank = fmt === 12 && (pid === 3 || pid === 0) ? 2 : fmt === 4 && (pid === 0 || (pid === 3 && (eid === 1 || eid === 10))) ? 1 : -1;
    if (rank > bestRank) {
      bestRank = rank;
      best = off;
    }
  }
  if (best < 0) throw new Error('no_unicode_cmap');
  const out = new Set();
  const fmt = r.u16(best);
  if (fmt === 12) {
    const nGroups = r.u32(best + 12);
    for (let g = 0; g < nGroups; g++) {
      const o = best + 16 + g * 12;
      const start = r.u32(o);
      const end = r.u32(o + 4);
      const glyph = r.u32(o + 8);
      if (end - start > 0x110000) throw new Error('cmap_bad_group');
      for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) out.add(c);
    }
    return out;
  }
  // Format 4.
  const segX2 = r.u16(best + 6);
  const ends = best + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffs = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = r.u16(ends + s * 2);
    const start = r.u16(starts + s * 2);
    const delta = r.i16(deltas + s * 2);
    const ro = r.u16(rangeOffs + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph;
      if (ro === 0) glyph = (c + delta) & 0xffff;
      else {
        const g = r.u16(rangeOffs + s * 2 + ro + (c - start) * 2);
        glyph = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(c);
    }
  }
  return out;
}

module.exports = { cmapCodepoints };
