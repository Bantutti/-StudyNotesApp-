/**
 * @jest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { decode, toWebSchema, type InkItem, type ToNative } from '../../src/modules/editor/protocol';
import { createInkLayer } from '../src/ink';

const B1 = 'b_AAAAAAAAAA01';
const B2 = 'b_AAAAAAAAAA02';
const item = (id: number, over: Partial<InkItem> = {}): InkItem => ({
  id: `s_${String(id).padStart(16, '0')}`,
  b: B1,
  layer: 'over',
  mode: 'stroke',
  w: 3,
  c: 'p0',
  d: 'M10 10L50 20',
  ...over,
});

/** jsdom has no layout: give elements fixed boxes. */
function box(el: Element, left: number, top: number, width: number, height: number) {
  (el as HTMLElement).getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}

function setup() {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  root.id = 'root';
  const editorEl = document.createElement('div');
  editorEl.id = 'editor';
  root.appendChild(editorEl);
  document.body.appendChild(root);
  const p1 = document.createElement('p');
  p1.setAttribute('data-block-id', B1);
  const list = document.createElement('ul');
  list.setAttribute('data-block-id', 'b_LIST00000001');
  const li = document.createElement('li');
  li.setAttribute('data-block-id', B2);
  list.appendChild(li);
  editorEl.append(p1, list);
  box(root, 0, -200, 400, 2000); // page scrolled by 200 px
  box(p1, 20, -180, 360, 30);
  box(list, 20, -140, 360, 60);
  box(li, 40, -140, 340, 30);
  const sent: ToNative[] = [];
  const frames: (() => void)[] = [];
  const ink = createInkLayer({ root, editorEl, post: (m) => sent.push(m), raf: (fn) => frames.push(fn) });
  const flush = () => frames.splice(0).forEach((f) => f());
  return { root, editorEl, p1, li, ink, sent, flush };
}

describe('editor page ink layers', () => {
  it('puts the under-layer before the editor and the over-layer after it', () => {
    const { root } = setup();
    expect([...root.children].map((c) => c.id)).toEqual(['ink-under', 'editor', 'ink-over']);
  });

  it('draws items as SVG paths with attributes only, and acknowledges them', () => {
    const { root, ink, sent, flush } = setup();
    ink.add([item(1), item(2, { layer: 'under', c: 'h0', w: 14 }), item(3, { mode: 'fill', c: '#1F3A5F', d: 'M0 0L10 0L10 10Z' })]);
    flush();
    const over = root.querySelector('#ink-over svg') as SVGSVGElement;
    const under = root.querySelector('#ink-under svg') as SVGSVGElement;
    expect(over.getAttribute('viewBox')).toBe('0 0 1000 1000');
    const p1 = over.querySelector('[data-ink-id="s_0000000000000001"]') as SVGPathElement;
    expect(p1.getAttribute('d')).toBe('M10 10L50 20');
    expect(p1.style.getPropertyValue('stroke')).toBe('var(--ink-p0)');
    expect(p1.getAttribute('stroke-linecap')).toBe('round');
    const p3 = over.querySelector('[data-ink-id="s_0000000000000003"]') as SVGPathElement;
    expect(p3.style.getPropertyValue('fill')).toBe('#1F3A5F');
    expect(under.querySelectorAll('path')).toHaveLength(1);
    expect(sent).toContainEqual({ v: 1, type: 'inkAck', ids: ['s_0000000000000001', 's_0000000000000002', 's_0000000000000003'] });
  });

  it('places each block group over its block, scaled to the block width', () => {
    const { root, ink, flush } = setup();
    ink.add([item(1), item(2, { b: B2 })]);
    flush();
    const g1 = root.querySelector(`#ink-over svg[data-ink-block="${B1}"]`) as SVGSVGElement;
    const g2 = root.querySelector(`#ink-over svg[data-ink-block="${B2}"]`) as SVGSVGElement;
    expect([g1.style.left, g1.style.top, g1.style.width]).toEqual(['20px', '20px', '360px']);
    expect([g2.style.left, g2.style.top, g2.style.width]).toEqual(['40px', '60px', '340px']);
  });

  it('hides ink whose block is gone and shows it again when the block comes back', () => {
    const { root, editorEl, p1, ink, flush } = setup();
    ink.add([item(1)]);
    flush();
    p1.remove();
    ink.refresh();
    flush();
    const g = root.querySelector(`#ink-over svg[data-ink-block="${B1}"]`) as SVGSVGElement;
    expect(g.style.display).toBe('none');
    expect(ink.size).toBe(1); // kept (decision Q4)
    editorEl.prepend(p1);
    ink.refresh();
    flush();
    expect(g.style.display).toBe('');
  });

  it('replaces an item with the same id, removes items and drops empty groups', () => {
    const { root, ink } = setup();
    ink.add([item(1), item(1, { d: 'M0 0L1 1' })]);
    expect(root.querySelectorAll('path')).toHaveLength(1);
    ink.remove(['s_0000000000000001']);
    expect(root.querySelectorAll('svg')).toHaveLength(0);
    ink.add([item(2), item(3)]);
    ink.clear();
    expect(ink.size).toBe(0);
  });

  it('sets the pack ink colours as CSS variables', () => {
    const { root, ink } = setup();
    ink.setPalette({ pens: ['#111111', '#222222', '#333333'], highlighter: '#FFE98A' });
    expect(root.style.getPropertyValue('--ink-p1')).toBe('#222222');
    expect(root.style.getPropertyValue('--ink-h0')).toBe('#FFE98A');
  });

  it('reports the layout in page px (independent of scrolling) with nesting depth', () => {
    const { ink, sent } = setup();
    ink.layout(7);
    const msg = sent.find((m) => m.type === 'inkLayout');
    expect(msg).toMatchObject({ reqId: 7, originX: 0, originY: -200, pageWidth: 400 });
    if (msg?.type !== 'inkLayout') throw new Error('no layout');
    expect(msg.blocks).toEqual([
      { id: B1, depth: 0, left: 20, top: 20, width: 360, height: 30 },
      { id: 'b_LIST00000001', depth: 0, left: 20, top: 60, width: 360, height: 60 },
      { id: B2, depth: 1, left: 40, top: 60, width: 340, height: 30 },
    ]);
  });

  it('feeds the layout once per frame while Draw mode is on', () => {
    const { ink, sent, flush } = setup();
    ink.setFeed(true);
    ink.refresh();
    ink.refresh();
    flush();
    expect(sent.filter((m) => m.type === 'inkLayout' && m.reqId === null)).toHaveLength(1);
    ink.setFeed(false);
    ink.refresh();
    flush();
    expect(sent.filter((m) => m.type === 'inkLayout')).toHaveLength(1);
  });

  it('throttles the layout feed while typing (at most one message per 120 ms, trailing)', () => {
    jest.useFakeTimers();
    const { ink, sent, flush } = setup();
    ink.setFeed(true);
    flush();
    ink.refresh();
    flush(); // within 120 ms of the first: deferred
    const feeds = () => sent.filter((m) => m.type === 'inkLayout' && m.reqId === null).length;
    expect(feeds()).toBe(1);
    jest.advanceTimersByTime(130);
    expect(feeds()).toBe(2);
    jest.useRealTimers();
  });

  it('refuses more than the stroke cap and reports invalid_ink', () => {
    const { ink, sent } = setup();
    for (let k = 0; k < 20; k++) ink.add(Array.from({ length: 500 }, (_, i) => item(k * 500 + i + 1)));
    expect(ink.size).toBe(10_000);
    ink.add([item(99_999)]);
    expect(ink.size).toBe(10_000);
    expect(sent).toContainEqual({ v: 1, type: 'error', code: 'invalid_ink' });
  });

  it('the page decoder rejects hostile ink messages before they reach the layer', () => {
    const msg = (items: unknown) => JSON.stringify({ v: 1, type: 'inkAdd', items });
    expect(decode(msg([item(1)]), toWebSchema).ok).toBe(true);
    expect(decode(msg([{ ...item(1), d: 'M0 0" onload="x' }]), toWebSchema).ok).toBe(false);
    expect(decode(msg([{ ...item(1), c: 'expression(alert(1))' }]), toWebSchema).ok).toBe(false);
  });

  it('never builds ink markup from strings (no innerHTML in the ink code)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'ink.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|setAttribute\(\s*['"]style/);
  });
});
