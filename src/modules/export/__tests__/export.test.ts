import JSZip from 'jszip';

import { SAMPLE_NOTE, type NoteDoc } from '@/core';
import { createPackRegistry, type FontFaceData } from '@/modules/stylepacks';

import { buildDocx } from '../docx';
import { createDocxExporter, createPdfExporter, exportFileName } from '../exporters';
import { EXPORT_CSP, renderExportHtml, renderNodes } from '../html';

const packs = createPackRegistry();
const pastel = packs.getOrDefault('pastel-highlight');
const dark = packs.getOrDefault('dark-academia');
const input = (doc: NoteDoc = SAMPLE_NOTE, faces: FontFaceData[] = []) => ({ doc, pack: pastel, faces, title: 'T', paper: 'A4' as const });

describe('export HTML', () => {
  it('escapes note text and titles', () => {
    const doc: NoteDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] }] };
    const html = renderExportHtml({ ...input(doc), title: '</title><script>x</script>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script');
  });
  it('carries a no-script, no-network CSP', () => {
    const html = renderExportHtml(input());
    expect(html).toContain(EXPORT_CSP);
    expect(EXPORT_CSP).toContain("script-src 'none'");
    expect(EXPORT_CSP).toContain("default-src 'none'");
  });
  it('drops unsafe links even if a bad doc bypassed validation', () => {
    const html = renderNodes([{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }]);
    expect(html).toBe('x');
  });
  it('renders study blocks with pack classes', () => {
    const html = renderExportHtml(input());
    expect(html).toContain('class="pk-def" data-term="Osmosis"');
    expect(html).toContain('class="pk-call"');
    expect(html).toContain('<mark data-k="k0">passive transport</mark>');
    expect(html).toContain('data-h="highlight-swipe"');
  });
});

describe('DOCX', () => {
  it('produces a valid package with text, highlight shading and background', async () => {
    const bytes = await buildDocx({ ...input(), pack: dark });
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('passive transport');
    expect(xml).toContain('w:background');
    expect(xml).toMatch(/w:shd [^>]*w:fill="[0-9A-F]{6}"/);
    expect(xml).toContain('DEFINITION');
  });
  it('embeds bundled fonts when provided', async () => {
    const faces: FontFaceData[] = [{ family: 'Gaegu', weight: 400, style: 'normal', base64: Buffer.from('fake-ttf-bytes').toString('base64') }];
    const zip = await JSZip.loadAsync(await buildDocx(input(SAMPLE_NOTE, faces)));
    const names = Object.keys(zip.files);
    expect(names.some((n) => n.startsWith('word/fonts/'))).toBe(true);
  });
});

describe('exporters (adapters faked)', () => {
  it('PDF exporter passes the page size and reports size', async () => {
    const calls: number[][] = [];
    const ex = createPdfExporter(
      { printToFile: async (_h, w, h) => { calls.push([w, h]); return { uri: 'file:///cache/x.pdf' }; }, print: async () => undefined },
      { sizeOf: () => 1234 },
    );
    const r = await ex.run({ ...input(), paper: 'Letter' });
    expect(calls[0]).toEqual([612, 792]);
    expect(r).toMatchObject({ format: 'pdf', uri: 'file:///cache/x.pdf', bytes: 1234 });
  });
  it('DOCX exporter writes an app-generated file name', async () => {
    let name = '';
    const ex = createDocxExporter({ writeBytes: async (n, b) => { name = n; return { uri: `file:///${n}`, size: b.length }; }, sizeOf: () => null });
    const r = await ex.run(input());
    expect(name).toMatch(/^note-\d{8}T\d{6}\.docx$/);
    expect(r.bytes).toBeGreaterThan(1000);
    expect(exportFileName('pdf', new Date('2026-11-01T10:15:30Z'))).toBe('note-20261101T101530.pdf');
  });
});
