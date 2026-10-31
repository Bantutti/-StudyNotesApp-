import { base64ToBytes, bytesToBase64 } from '../base64';
import { escapeHtml, safeHref } from '../escape';
import { createIdGenerator, createSeqIdGenerator } from '../ids';
import { mad, median, percentile, round } from '../stats';
import { utf8Length } from '../validation';

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    for (let len = 0; len < 40; len++) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len) & 0xff);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });
  it('matches Node for a known value', () => {
    expect(bytesToBase64(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))).toBe(Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString('base64'));
  });
  it('rejects malformed input', () => {
    expect(() => base64ToBytes('abc')).toThrow('invalid_base64');
    expect(() => base64ToBytes('ab$=')).toThrow('invalid_base64');
  });
});

describe('escape', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<img src=x onerror="a()">&'`)).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  });
  it('allows only http(s) and mailto links', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(' data:text/html,x')).toBeNull();
    expect(safeHref('file:///etc/passwd')).toBeNull();
  });
});

describe('ids', () => {
  it('uses the injected random source', () => {
    const gen = createIdGenerator((n) => new Uint8Array(n));
    expect(gen.newId('b')).toBe('b_0000000000000000');
    expect(createSeqIdGenerator().newId('r')).toBe('r_0000000000000001');
  });
});

describe('stats', () => {
  it('computes percentiles and spread', () => {
    const xs = [1, 2, 3, 4, 100];
    expect(median(xs)).toBe(3);
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 100)).toBe(100);
    expect(mad(xs)).toBe(1);
    expect(round(1.23456, 2)).toBe(1.23);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('utf8Length', () => {
  it('matches Buffer.byteLength', () => {
    for (const s of ['abc', 'ñandú', 'Pag hypertonic 😀', '日本語']) expect(utf8Length(s)).toBe(Buffer.byteLength(s, 'utf8'));
  });
});
