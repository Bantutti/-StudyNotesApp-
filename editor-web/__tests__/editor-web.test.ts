/**
 * @jest-environment jsdom
 */
import { validateNoteDoc, listBlockIds, SAMPLE_NOTE } from '../../src/core/document';
import { runCommand } from '../src/commands';
import { createEditor } from '../src/createEditor';
import { stripDangerousHtml } from '../src/sanitize';

let counter = 0;
const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + counter++) & 0xff);

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return createEditor({ element: el, random });
}

describe('TipTap editor with our schema', () => {
  it('round-trips the sample note through our document schema', () => {
    const ed = mount();
    ed.commands.setContent(SAMPLE_NOTE, { emitUpdate: false });
    const r = validateNoteDoc(ed.getJSON());
    expect(r.ok).toBe(true);
    if (r.ok) expect(listBlockIds(r.value)).toEqual(listBlockIds(SAMPLE_NOTE));
    ed.destroy();
  });

  it('gives a new block a fresh unique id when a paragraph is split', () => {
    const ed = mount();
    ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b_original000001' }, content: [{ type: 'text', text: 'hello world' }] }] });
    ed.commands.setTextSelection(6);
    ed.commands.splitBlock();
    const r = validateNoteDoc(ed.getJSON());
    expect(r.ok).toBe(true);
    const ids = r.ok ? listBlockIds(r.value) : [];
    expect(ids[0]).toBe('b_original000001');
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    ed.destroy();
  });

  it('applies pack-keyed highlights and study blocks via commands', () => {
    const ed = mount();
    ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'osmosis' }] }] });
    ed.commands.selectAll();
    runCommand(ed, 'highlight', 'k2');
    runCommand(ed, 'definition', 'Osmosis');
    const json = JSON.stringify(ed.getJSON());
    expect(json).toContain('"key":"k2"');
    expect(json).toContain('"type":"definition"');
    expect(validateNoteDoc(ed.getJSON()).ok).toBe(true);
    ed.destroy();
  });

  it('drops pasted HTML outside the schema (scripts, images, handlers)', () => {
    const ed = mount();
    ed.commands.setContent('<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(2)"><p onclick="x()">two</p>');
    const json = JSON.stringify(ed.getJSON());
    expect(json).not.toMatch(/script|img|onerror|onclick/i);
    expect(json).toContain('two');
    ed.destroy();
  });

  it('refuses javascript: links', () => {
    const ed = mount();
    ed.commands.setContent('<p><a href="javascript:alert(1)">x</a> <a href="https://ok.example">y</a></p>');
    const json = JSON.stringify(ed.getJSON());
    expect(json).not.toContain('javascript:');
    expect(json).toContain('https://ok.example');
    ed.destroy();
  });
});

describe('paste sanitizer', () => {
  it('removes active content, handlers and dangerous URLs', () => {
    const dirty = '<p style="x" onclick="a()">Hi</p><script>evil()</script><img src=x onerror=y><a href="javascript:z()">l</a><iframe src="https://x"></iframe><!-- c -->';
    const clean = stripDangerousHtml(dirty);
    expect(clean).not.toMatch(/script|evil|onerror|onclick|style=|javascript:|iframe|<img|<!--/i);
    expect(clean).toBe('<p>Hi</p><a>l</a>');
  });
  it('handles nested and malformed markup', () => {
    const clean = stripDangerousHtml('<div><scr<script>ipt>alert(1)</script></div><a href=" JaVaScRiPt:x()">a</a><b onmouseover=x>b</b>');
    expect(clean).not.toMatch(/<script|onmouseover|javascript/i);
    expect(clean).toContain('<b>b</b>');
  });
  it('refuses huge pastes', () => {
    expect(stripDangerousHtml('a'.repeat(1_000_001))).toBe('');
  });
});
