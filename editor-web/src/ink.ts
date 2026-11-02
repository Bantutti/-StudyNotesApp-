/**
 * Ink on the editor page (P4b, decision Q1: finished strokes live in the
 * WebView, so they scroll, reflow and print with the text).
 *
 * Structure (outside ProseMirror's DOM, so the editor never sees or edits it):
 *   #root.pk
 *     #ink-under  (z-index 0)  highlighter strokes, BEHIND the text
 *     #editor     (z-index 1)  the TipTap page
 *     #ink-over   (z-index 2)  pen strokes, ON TOP of the text
 * Each layer holds one <svg> per block that has ink, placed over that block:
 *   left/top = the block's offset inside #root, width = the block's width,
 *   viewBox 0 0 1000 1000 and aspect-ratio 1, so 1 unit = width/1000 px on
 *   both axes (INK_MATH §1.2); overflow is visible (ink may leave the box).
 * A stroke whose block isn't in the document is kept but hidden (decision Q4:
 * it reappears when undo, restore or sync brings the block back).
 *
 * SECURITY: items arrive already validated by the bridge schema (path data
 * limited to [MLQZ0-9 .-], colours an enum or "#RRGGBB", ids by pattern).
 * Elements are built with createElementNS and set with setAttribute /
 * style.setProperty only: never innerHTML, never untrusted CSS text.
 *
 * Positions are re-measured at most once per animation frame, after editor
 * transactions, resizes and font loads (refresh()).
 */
import { INK_MAX_ITEMS, type InkBlockBox, type InkItem, type ToNative } from '../../src/modules/editor/protocol';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYOUT_MAX_BLOCKS = 5_000;
/** The layout feed sends at most once per this many ms (typing must stay cheap). */
export const FEED_MIN_INTERVAL_MS = 120;

export interface InkPalette {
  pens: readonly [string, string, string];
  highlighter: string;
}

export interface InkLayerDeps {
  root: HTMLElement;
  editorEl: HTMLElement;
  post: (msg: ToNative) => void;
  /** requestAnimationFrame (injected so tests can run frames by hand). */
  raf?: (fn: () => void) => void;
}

interface Group {
  under: SVGSVGElement;
  over: SVGSVGElement;
  count: number;
}

/** The colour for a stroke: a pack key resolves through CSS variables set by setPalette(). */
function colourOf(c: string): string {
  return c.startsWith('#') ? c : `var(--ink-${c})`;
}

/** Number of block-id ancestors (0 = top-level block). */
function depthOf(el: Element, editorEl: HTMLElement): number {
  let d = 0;
  for (let p = el.parentElement; p && p !== editorEl; p = p.parentElement) if (p.hasAttribute('data-block-id')) d++;
  return d;
}

export function createInkLayer(deps: InkLayerDeps) {
  const { root, editorEl } = deps;
  const raf = deps.raf ?? ((fn: () => void) => void requestAnimationFrame(() => fn()));
  const mk = (id: string) => {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'ink-layer';
    el.setAttribute('aria-hidden', 'true');
    return el;
  };
  const underEl = mk('ink-under');
  const overEl = mk('ink-over');
  root.insertBefore(underEl, root.firstChild);
  root.appendChild(overEl);

  const paths = new Map<string, { el: SVGPathElement; block: string }>();
  const groups = new Map<string, Group>();
  let feedOn = false;
  let scheduled = false;
  let lastFeed = -Infinity; // the first layout goes out at once
  let feedTimer: ReturnType<typeof setTimeout> | null = null;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /** Sends the layout now, or once the minimum interval has passed (trailing). */
  const pushFeed = (): void => {
    if (!feedOn || feedTimer) return;
    const wait = FEED_MIN_INTERVAL_MS - (now() - lastFeed);
    const send = () => {
      feedTimer = null;
      lastFeed = now();
      if (feedOn) deps.post(layoutMessage(null));
    };
    if (wait <= 0) send();
    else feedTimer = setTimeout(send, wait);
  };

  const svgFor = (block: string): Group => {
    let g = groups.get(block);
    if (!g) {
      const mkSvg = () => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'ink-b');
        svg.setAttribute('viewBox', '0 0 1000 1000');
        svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
        svg.setAttribute('data-ink-block', block);
        return svg;
      };
      g = { under: mkSvg(), over: mkSvg(), count: 0 };
      underEl.appendChild(g.under);
      overEl.appendChild(g.over);
      groups.set(block, g);
    }
    return g;
  };

  /** Block elements by id (one DOM query per refresh). */
  const blockElements = (): Map<string, HTMLElement> => {
    const m = new Map<string, HTMLElement>();
    for (const el of Array.from(editorEl.querySelectorAll<HTMLElement>('[data-block-id]'))) {
      const id = el.getAttribute('data-block-id');
      if (id && !m.has(id)) m.set(id, el);
    }
    return m;
  };

  /** Places every block's svg over its block (or hides it when the block is gone). */
  const position = (els: Map<string, HTMLElement>): void => {
    const r = root.getBoundingClientRect();
    for (const [block, g] of groups) {
      const el = els.get(block);
      for (const svg of [g.under, g.over]) {
        if (!el) {
          svg.style.setProperty('display', 'none');
          continue;
        }
        const b = el.getBoundingClientRect();
        const w = Math.max(1, b.width);
        svg.style.removeProperty('display');
        svg.style.setProperty('left', `${b.left - r.left}px`);
        svg.style.setProperty('top', `${b.top - r.top}px`);
        svg.style.setProperty('width', `${w}px`);
        if (el.classList.contains('pk-sketch')) {
          // Sketch block (decision Q2): ink is clipped to the frame. The viewBox
          // keeps 1000 units = width and spans exactly the block's height.
          const h = Math.max(1, b.height);
          svg.setAttribute('viewBox', `0 0 1000 ${Math.round((h * 1000) / w)}`);
          svg.style.setProperty('height', `${h}px`);
          svg.style.setProperty('aspect-ratio', 'auto');
          svg.style.setProperty('overflow', 'hidden');
        }
      }
    }
  };

  /** Measures every block with an id, in page px (relative to #root). */
  const measure = (els: Map<string, HTMLElement>): InkBlockBox[] => {
    const r = root.getBoundingClientRect();
    const out: InkBlockBox[] = [];
    for (const [id, el] of els) {
      if (out.length >= LAYOUT_MAX_BLOCKS) break;
      const b = el.getBoundingClientRect();
      out.push({ id, depth: Math.min(32, depthOf(el, editorEl)), left: b.left - r.left, top: b.top - r.top, width: b.width, height: b.height });
    }
    return out;
  };

  const layoutMessage = (reqId: number | null): ToNative => {
    const els = blockElements();
    const r = root.getBoundingClientRect();
    return {
      v: 1,
      type: 'inkLayout',
      reqId,
      originX: r.left,
      originY: r.top,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageWidth: r.width,
      blocks: measure(els),
    };
  };

  /** Re-measure on the next frame (many calls in one frame = one measurement). */
  const refresh = (): void => {
    if (scheduled) return;
    scheduled = true;
    raf(() => {
      scheduled = false;
      position(blockElements());
      pushFeed();
    });
  };

  const removeOne = (id: string): void => {
    const p = paths.get(id);
    if (!p) return;
    p.el.remove();
    paths.delete(id);
    const g = groups.get(p.block);
    if (g && --g.count <= 0) {
      g.under.remove();
      g.over.remove();
      groups.delete(p.block);
    }
  };

  return {
    /** Draws validated items (replacing any with the same id) and acknowledges them. */
    add(items: readonly InkItem[]): void {
      const drawn: string[] = [];
      for (const it of items) {
        removeOne(it.id);
        // Hard cap (the same as the ink file's stroke cap): refuse, never grow without bound.
        if (paths.size >= INK_MAX_ITEMS) {
          deps.post({ v: 1, type: 'error', code: 'invalid_ink' });
          break;
        }
        const g = svgFor(it.b);
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', it.d);
        path.setAttribute('data-ink-id', it.id);
        const colour = colourOf(it.c);
        if (it.mode === 'stroke') {
          path.style.setProperty('fill', 'none');
          path.style.setProperty('stroke', colour);
          path.setAttribute('stroke-width', String(it.w));
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
        } else {
          path.style.setProperty('fill', colour);
          path.setAttribute('fill-rule', 'nonzero');
        }
        (it.layer === 'under' ? g.under : g.over).appendChild(path);
        g.count++;
        paths.set(it.id, { el: path, block: it.b });
        drawn.push(it.id);
      }
      refresh();
      if (drawn.length) deps.post({ v: 1, type: 'inkAck', ids: drawn });
    },
    remove(ids: readonly string[]): void {
      for (const id of ids) removeOne(id);
    },
    clear(): void {
      for (const id of [...paths.keys()]) removeOne(id);
    },
    /** Pack ink colours as CSS variables (values come from the validated pack). */
    setPalette(p: InkPalette): void {
      root.style.setProperty('--ink-p0', p.pens[0]);
      root.style.setProperty('--ink-p1', p.pens[1]);
      root.style.setProperty('--ink-p2', p.pens[2]);
      root.style.setProperty('--ink-h0', p.highlighter);
    },
    setFeed(on: boolean): void {
      feedOn = on;
      if (on) refresh();
      else if (feedTimer) {
        clearTimeout(feedTimer);
        feedTimer = null;
      }
    },
    layout: (reqId: number) => deps.post(layoutMessage(reqId)),
    refresh,
    /** For tests and diagnostics. */
    get size() {
      return paths.size;
    },
  };
}

export type InkLayerHandle = ReturnType<typeof createInkLayer>;
