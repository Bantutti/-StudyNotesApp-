/**
 * @jest-environment jsdom
 */
import { validateNoteDoc, listBlockIds, SAMPLE_NOTE } from '../../src/core/document';
import { runCommand } from '../src/commands';
import { createEditor } from '../src/createEditor';
import { requestDocReply } from '../src/replies';
import { stripDangerousHtml } from '../src/sanitize';

let counter = 0;
const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + counter++) & 0xff);

function mount(onLinkTap?: (href: string) => void) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return createEditor({ element: el, random, onLinkTap });
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

describe('links (open outside the app)', () => {
  it('a tap on a link cancels navigation and reports the href', () => {
    const taps: string[] = [];
    const ed = mount((h) => taps.push(h));
    ed.commands.setContent('<p>see <a href="https://example.com/x">this</a> and <a href="mailto:prof@school.edu">mail</a></p>');
    const links = ed.view.dom.querySelectorAll('a');
    expect(links).toHaveLength(2);
    for (const a of Array.from(links)) {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      a.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(taps).toEqual(['https://example.com/x', 'mailto:prof@school.edu']);
    ed.destroy();
  });

  it('clicks elsewhere are not reported', () => {
    const taps: string[] = [];
    const ed = mount((h) => taps.push(h));
    ed.commands.setContent('<p>plain text</p>');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    ed.view.dom.querySelector('p')?.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(taps).toEqual([]);
    ed.destroy();
  });

  it('keeps audio anchors in the JSON but never takes them from HTML', () => {
    const ed = mount();
    const anchor = { recordingId: 'rec_0000000000000001', startMs: 5, endMs: 9 };
    ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b_anchored00001', audioAnchor: anchor }, content: [{ type: 'text', text: 'x' }] }] });
    expect(JSON.stringify(ed.getJSON())).toContain('"startMs":5');
    expect(validateNoteDoc(ed.getJSON()).ok).toBe(true);
    ed.commands.setContent('<p data-block-id="b_anchored00002" audioanchor="x" data-audio-anchor="{}">pasted</p>');
    expect(JSON.stringify(ed.getJSON())).toContain('"audioAnchor":null');
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

describe('requestDoc reply (review M1: never a stand-in document)', () => {
  it('a valid live document is sent with the request id', () => {
    const r = requestDocReply(SAMPLE_NOTE, 7);
    expect(r).toMatchObject({ type: 'doc', reqId: 7, reason: 'request' });
    expect(validateNoteDoc((r as { doc: unknown }).doc).ok).toBe(true);
  });

  it('an invalid live document becomes an error with the same request id, not an empty doc', () => {
    const bad = { type: 'doc', content: [{ type: 'script', content: [{ type: 'text', text: 'x' }] }] };
    const r = requestDocReply(bad, 42);
    expect(r).toEqual({ v: 1, type: 'error', code: 'invalid_doc', reqId: 42 });
    expect(JSON.stringify(r)).not.toContain('"content":[]');
  });

  it('an oversized live document is a too_large error for the request', () => {
    const big = { type: 'doc', content: Array.from({ length: 30_000 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `line ${i} `.repeat(20) }] })) };
    expect(requestDocReply(big, 3)).toEqual({ v: 1, type: 'error', code: 'too_large', reqId: 3 });
  });
});
