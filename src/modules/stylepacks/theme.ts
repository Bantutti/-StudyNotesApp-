/**
 * Pack -> CSS. Per-pack output is ONLY CSS custom properties; all component
 * CSS is static (BASE_CSS) and keyed by data attributes. The editor WebView
 * and every exporter use this same function, which is what makes the
 * screen and the PDF look the same.
 */
import { composite, contrast, mix } from './color';
import { bulletUri, dividerBg, svgDataUri } from './decor';
import type { StylePack } from './schema';

const BODY_PX: Record<StylePack['fonts']['bodySize'], number> = { s: 14.5, m: 15.5, l: 17 };

/** Highlighter i composited over paper, so screen == validator == export. */
export function highlighterColor(p: StylePack, i: number): string {
  const h = p.highlighters[i % p.highlighters.length] as StylePack['highlighters'][number];
  return composite(h.color, p.paper.color, h.opacity);
}

function washi(p: StylePack): string {
  const a = highlighterColor(p, 0);
  const b = highlighterColor(p, 1);
  const s = p.palette.soft;
  const k = p.palette.accent2;
  switch (p.decor.washi) {
    case 'dots':
      return `radial-gradient(circle, ${mix(a, '#FFFFFF', 0.55)} 2px, transparent 2.5px) 0 0/10px 10px, ${a}`;
    case 'gingham':
      return `repeating-linear-gradient(0deg, ${mix(s, k, 0.28)}88 0 6px, transparent 6px 12px), repeating-linear-gradient(90deg, ${mix(s, k, 0.28)}88 0 6px, transparent 6px 12px), ${s}`;
    case 'plain':
      return a;
    default:
      return `repeating-linear-gradient(135deg, ${a} 0 8px, ${b} 8px 16px)`;
  }
}

function paperBg(p: StylePack): { image: string; size: string } {
  const g = p.paper.lineGap;
  const L = p.paper.line;
  const img: string[] = [];
  const size: string[] = [];
  const dark = p.meta.appearance === 'dark';
  if (p.paper.texture !== 'none') {
    const op = p.paper.texture === 'chalk' ? 0.1 : dark ? 0.07 : 0.05;
    const col = dark || p.paper.texture === 'chalk' ? 1 : 0;
    img.push(
      svgDataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 ${col} 0 0 0 0 ${col} 0 0 0 0 ${col} 0 0 0 ${op} 0"/></filter><rect width="160" height="160" filter="url(#n)"/></svg>`,
      ),
    );
    size.push('160px 160px');
  }
  const m = mix(p.paper.color, p.palette.accent2, 0.5);
  if (p.paper.margin === 'left') {
    img.push(`linear-gradient(90deg, transparent 30px, ${m} 30px, ${m} 31.5px, transparent 31.5px)`);
    size.push('auto');
  }
  if (p.paper.margin === 'double') {
    img.push(
      `linear-gradient(90deg, transparent 28px, ${m} 28px, ${m} 29.5px, transparent 29.5px, transparent 32px, ${m} 32px, ${m} 33.5px, transparent 33.5px)`,
    );
    size.push('auto');
  }
  if (p.paper.type === 'lined') {
    img.push(`repeating-linear-gradient(to bottom, transparent 0, transparent ${g - 1}px, ${L} ${g - 1}px, ${L} ${g}px)`);
    size.push('auto');
  }
  if (p.paper.type === 'grid') {
    img.push(`linear-gradient(${L} 1px, transparent 1px)`, `linear-gradient(90deg, ${L} 1px, transparent 1px)`);
    size.push(`${g}px ${g}px`, `${g}px ${g}px`);
  }
  if (p.paper.type === 'dotted') {
    img.push(`radial-gradient(circle, ${L} 1.3px, transparent 1.8px)`);
    size.push(`${g}px ${g}px`);
  }
  return { image: img.join(', ') || 'none', size: size.join(', ') || 'auto' };
}

/** CSS custom properties for one pack, as a declaration list. */
export function packVars(p: StylePack): Record<string, string> {
  const bg = paperBg(p);
  const dv = dividerBg(p);
  const f = p.fonts;
  const base = BODY_PX[f.bodySize];
  const onAccent =
    contrast(p.paper.color, p.palette.accent) >= contrast(p.palette.ink, p.palette.accent) ? p.paper.color : p.palette.ink;
  const v: Record<string, string> = {
    '--paper': p.paper.color,
    '--line': p.paper.line,
    '--ink': p.palette.ink,
    '--accent': p.palette.accent,
    '--accent2': p.palette.accent2,
    '--muted': p.palette.muted,
    '--soft': p.palette.soft,
    '--onaccent': onAccent,
    '--hfont': `'${f.header}', cursive`,
    '--bfont': `'${f.body}', sans-serif`,
    '--hw': String(f.headerWeight),
    '--hi': f.headerItalic ? 'italic' : 'normal',
    '--htt': f.headerCase === 'upper' ? 'uppercase' : 'none',
    '--hvar': f.headerCase === 'smallcaps' ? 'small-caps' : 'normal',
    '--hsize': `${(base * f.headerScale).toFixed(1)}px`,
    '--bsize': `${base}px`,
    '--gap': `${p.paper.lineGap}px`,
    '--padl': p.paper.margin === 'none' ? '22px' : '46px',
    '--bg-img': bg.image,
    '--bg-size': bg.size,
    '--washi': washi(p),
    '--bullet': bulletUri(p),
    '--divider': dv.image,
    '--divider-size': dv.size,
    '--divider-repeat': dv.repeat,
  };
  for (let i = 0; i < 6; i++) v[`--hl${i}`] = highlighterColor(p, i);
  return v;
}

/** Full theme stylesheet for a pack, scoped to `.pk`. */
export function packCss(p: StylePack): string {
  const decl = Object.entries(packVars(p))
    .map(([k, val]) => `${k}:${val}`)
    .join(';');
  return `.pk{${decl}}\n${BASE_CSS}`;
}

/** Data attributes that select static component styles. */
export function packAttrs(p: StylePack): Record<string, string> {
  return {
    'data-h': p.header.style,
    'data-c': p.blocks.callout,
    'data-d': p.blocks.definition,
    'data-app': p.meta.appearance,
    'data-m': p.layout.margin,
  };
}

/**
 * Static component CSS. Structure it styles (shared by editor and export):
 *   .pk > h1.pk-h1 > span.t | h2.pk-h2 | h3.pk-h3 | p | ul.pk-ul | ol.pk-ol
 *   div.pk-def[data-term] > (div.pk-def-l + div.pk-term)? + p...
 *   div.pk-call > p... | hr | mark.hl[data-k=k0..k5]
 */
export const BASE_CSS = `
.pk{position:relative;background-color:var(--paper);background-image:var(--bg-img);background-size:var(--bg-size);color:var(--ink);font-family:var(--bfont);font-size:var(--bsize);line-height:var(--gap);padding:var(--gap) 22px var(--gap) var(--padl);-webkit-print-color-adjust:exact;print-color-adjust:exact;overflow-wrap:anywhere}
.pk[data-m=wide]{padding-right:30px}
.pk p{margin:0;min-height:var(--gap)}
.pk strong,.pk b{font-weight:700}
.pk mark{color:inherit;padding:0 .15em;border-radius:2px;-webkit-box-decoration-break:clone;box-decoration-break:clone;background:var(--hl0)}
.pk mark[data-k=k0]{background:var(--hl0)}.pk mark[data-k=k1]{background:var(--hl1)}.pk mark[data-k=k2]{background:var(--hl2)}
.pk mark[data-k=k3]{background:var(--hl3)}.pk mark[data-k=k4]{background:var(--hl4)}.pk mark[data-k=k5]{background:var(--hl5)}
.pk a{color:var(--accent2);text-decoration:underline}
.pk h1,.pk h2,.pk h3{margin:0;font-family:var(--hfont);font-weight:var(--hw);font-style:var(--hi);text-transform:var(--htt);font-variant:var(--hvar);color:var(--accent);break-after:avoid}
.pk h1{position:relative;padding:calc(var(--gap)*.35) 0;font-size:var(--hsize);line-height:1.25}
.pk h1 .t{position:relative;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.pk h2{font-size:1.35em;line-height:var(--gap);padding-top:calc(var(--gap)*.25);display:table;border-bottom:2px solid var(--accent2)}
.pk h3{font-size:1.15em;line-height:var(--gap)}
.pk-doodle{display:inline-block;vertical-align:middle;margin-left:8px}
.pk[data-h=ribbon-banner] h1 .t,.pk[data-h=washi-tape] h1 .t,.pk[data-h=sticker-label] h1 .t,.pk[data-h=tab-label] h1 .t{display:inline-block}
.pk[data-h=highlight-swipe] h1 .t{background:linear-gradient(transparent 58%,var(--hl0) 58%,var(--hl0) 92%,transparent 92%);padding:0 .12em}
.pk[data-h=underline-swipe] h1 .t{text-decoration:underline wavy var(--accent2);text-decoration-thickness:2px;text-underline-offset:.22em}
.pk[data-h=ribbon-banner] h1 .t{background:var(--accent);color:var(--onaccent);padding:.06em .9em .12em;clip-path:polygon(0 0,100% 0,calc(100% - .45em) 50%,100% 100%,0 100%,.45em 50%)}
.pk[data-h=washi-tape] h1 .t{background:var(--washi);color:var(--ink);padding:.05em .55em .1em;transform:rotate(-1.4deg)}
.pk[data-h=bubble-outline] h1 .t{color:var(--paper);-webkit-text-stroke:2px var(--accent);paint-order:stroke fill;text-shadow:3px 3px 0 var(--accent2)}
.pk[data-h=small-caps-rule] h1{font-size:calc(var(--hsize)*.95);letter-spacing:.18em;border-bottom:1px solid var(--accent)}
.pk[data-h=tab-label] h1{border-bottom:2.5px solid var(--accent);padding-bottom:0}
.pk[data-h=tab-label] h1 .t{background:var(--accent);color:var(--onaccent);padding:.12em .6em .05em;border-radius:.35em .35em 0 0;font-size:.8em}
.pk[data-h=gold-underline] h1 .t{letter-spacing:.06em;padding-bottom:.18em;border-bottom:2px solid var(--accent)}
.pk[data-h=bow-underline] h1 .t{text-decoration:underline var(--accent2);text-decoration-thickness:1.5px;text-underline-offset:.2em}
.pk[data-h=sticker-label] h1 .t{background:var(--soft);color:var(--accent);padding:.12em .55em .16em;border-radius:999px;border:2.5px solid var(--accent);box-shadow:3px 3px 0 var(--accent2)}
.pk[data-h=bold-block] h1{border-left:7px solid var(--accent);padding-left:12px;color:var(--ink)}
.pk-def{margin:calc(var(--gap)*.5) 0;padding:calc(var(--gap)*.25) 14px calc(var(--gap)*.4);position:relative;break-inside:avoid}
.pk-def::before{content:"Definition";display:block;font:700 .62em/2 var(--bfont);letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.pk-def::after{content:attr(data-term);position:absolute;top:calc(var(--gap)*.25 + 1.2em);left:14px;font-family:var(--hfont);font-weight:var(--hw);font-style:var(--hi);font-size:1.45em;line-height:1.3;color:var(--ink)}
.pk-def>:first-child{margin-top:calc(1.45em*1.3 + 2px)}
.pk[data-d=boxed] .pk-def{border:1.5px solid var(--accent);border-radius:10px}
.pk[data-d=dashed-box] .pk-def{border:2px dashed var(--accent);border-radius:12px}
.pk[data-d=framed] .pk-def{border:3px double var(--accent);border-radius:4px}
.pk[data-d=tab-box] .pk-def{border:1.5px solid var(--accent);border-radius:0 10px 10px 10px;margin-top:var(--gap)}
.pk[data-d=index-card] .pk-def{background:var(--soft);border-top:3px solid var(--accent2);border-radius:3px}
.pk-call{margin:calc(var(--gap)*.5) 0;padding:calc(var(--gap)*.3) 14px;position:relative;break-inside:avoid}
.pk-call strong{font-family:var(--hfont);font-style:var(--hi);color:var(--accent);font-size:1.12em}
.pk[data-c=bubble] .pk-call{background:var(--soft);border-radius:18px 18px 18px 4px}
.pk[data-c=sticky-note] .pk-call{background:var(--hl2);transform:rotate(-.8deg)}
.pk[data-c=bordered] .pk-call{border:1.5px solid var(--accent);border-radius:6px}
.pk[data-c=side-bar] .pk-call{background:var(--soft);border-left:4px solid var(--accent);border-radius:0 6px 6px 0}
.pk[data-c=ticket] .pk-call{background:var(--soft);border:2px dashed var(--accent2);border-radius:12px}
.pk[data-c=scroll] .pk-call{background:var(--soft);border-top:3px double var(--accent);border-bottom:3px double var(--accent);font-style:italic}
.pk ul,.pk ol{margin:0;padding:0}
.pk ul{list-style:none}
.pk ul>li{padding-left:22px;background:var(--bullet) 2px calc(var(--gap)/2 - 6px)/12px 12px no-repeat}
.pk ol{padding-left:26px}
.pk ol>li::marker{color:var(--accent);font-weight:700}
.pk hr{border:0;height:18px;margin:calc(var(--gap)*.25) 0;background-image:var(--divider);background-size:var(--divider-size);background-repeat:var(--divider-repeat)}
.pk-corner{position:absolute;top:8px;right:10px}
.pk-tape{position:absolute;top:-6px;right:24px;width:86px;height:26px;background:var(--washi);opacity:.8;transform:rotate(6deg)}
`;
