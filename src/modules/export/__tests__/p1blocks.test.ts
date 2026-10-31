import JSZip from 'jszip';

import type { DocNode, NoteDoc } from '@/core';
import { createPackRegistry } from '@/modules/stylepacks';

import { buildDocx } from '../docx';
import { renderExportHtml } from '../html';

const pack = createPackRegistry().getOrDefault('pastel-highlight');
const p = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = (text: string, type: 'tableCell' | 'tableHeader' = 'tableCell'): DocNode => ({ type, content: [p(text)] });
const doc: NoteDoc = {
  type: 'doc',
  content: [
    { type: 'blockquote', content: [p('Quoted <b>line</b>')] },
    { type: 'summary', content: [p('Short summary')] },
    { type: 'qa', content: [{ type: 'qaQuestion', content: [{ type: 'text', text: 'What is ATP?' }] }, { type: 'qaAnswer', content: [p('Energy carrier')] }] },
    { type: 'columns', attrs: { layout: 'cornell' }, content: [{ type: 'column', content: [p('Cue')] }, { type: 'column', content: [p('Main notes')] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [cell('Term', 'tableHeader'), cell('Meaning', 'tableHeader')] }, { type: 'tableRow', content: [cell('ATP'), cell('energy')] }] },
  ],
};

describe('export of P1 blocks (basic; P6 polishes)', () => {
  it('renders every new block in HTML with pack classes and escaped text', () => {
    const html = renderExportHtml({ doc, pack, faces: [], title: 'T' });
    for (const needle of ['class="pk-quote"', 'class="pk-sum"', 'class="pk-qa"', 'class="pk-q"', 'class="pk-a"', 'data-layout="cornell"', 'class="pk-col"', 'class="pk-table"', '<th><p>Term</p></th>', '<td><p>ATP</p></td>']) {
      expect(html).toContain(needle);
    }
    expect(html).toContain('Quoted &lt;b&gt;line&lt;/b&gt;');
  });

  it('builds a DOCX with Word tables for columns and tables', async () => {
    const bytes = await buildDocx({ doc, pack, faces: [], title: 'T', paper: 'A4' });
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(2);
    for (const text of ['SUMMARY', 'What is ATP?', 'Main notes', 'Meaning']) expect(xml).toContain(text);
  });
});
