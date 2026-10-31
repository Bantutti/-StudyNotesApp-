/**
 * Original vector decorations keyed by pack enums (port of engine.js).
 * Every value interpolated here is a validated #RRGGBB colour or a number,
 * so the output cannot carry markup from a pack.
 */
import { mix } from './color';
import type { StylePack } from './schema';

export const svgDataUri = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const BULLETS: Record<StylePack['blocks']['bullet'], (c: string) => string> = {
  dot: (c) => `<circle cx="6" cy="6" r="3" fill="${c}"/>`,
  dash: (c) => `<rect x="1" y="5" width="10" height="2.2" rx="1" fill="${c}"/>`,
  star: (c) => `<path d="M6 .8l1.6 3.4 3.7.4-2.8 2.5.8 3.7L6 8.9 2.7 10.8l.8-3.7L.7 4.6l3.7-.4z" fill="${c}"/>`,
  heart: (c) =>
    `<path d="M6 10.6S1 7.4 1 4.2C1 2.5 2.3 1.4 3.7 1.4c1 0 1.8.6 2.3 1.4.5-.8 1.3-1.4 2.3-1.4C9.7 1.4 11 2.5 11 4.2c0 3.2-5 6.4-5 6.4z" fill="${c}"/>`,
  leaf: (c) => `<path d="M2 10C2 5 5 2 10.5 1.5 10 7 7 10 2 10z" fill="${c}"/>`,
  arrow: (c) =>
    `<path d="M2 6h7M6 2.8L9.4 6 6 9.2" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  square: (c) => `<rect x="2.5" y="2.5" width="7" height="7" rx="1.5" fill="${c}"/>`,
  seal: (c) => `<circle cx="6" cy="6" r="4.6" fill="${c}"/>`,
  check: (c) =>
    `<path d="M2 6.3l2.6 2.6L10 3.4" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
};

export function bulletUri(p: StylePack): string {
  const body = BULLETS[p.blocks.bullet](p.palette.accent);
  return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">${body}</svg>`);
}

/** Divider as a CSS background: { image, size, repeat }. */
export function dividerBg(p: StylePack): { image: string; size: string; repeat: string } {
  const a = p.palette.accent;
  const b = p.palette.accent2;
  const tile = (w: number, body: string) => ({
    image: svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="18">${body}</svg>`),
    size: `${w}px 18px`,
    repeat: 'repeat-x',
  });
  const center = (body: string) => ({
    image: svgDataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="18" viewBox="0 0 300 18" preserveAspectRatio="none">${body}</svg>`,
    ),
    size: '100% 18px',
    repeat: 'no-repeat',
  });
  switch (p.header.divider) {
    case 'squiggle':
      return tile(24, `<path d="M0 9 Q6 3 12 9 T24 9" stroke="${a}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
    case 'dots':
      return tile(18, `<circle cx="9" cy="9" r="2.4" fill="${a}" opacity=".7"/>`);
    case 'stars':
      return tile(30, `<path d="M15 3.5l1.8 3.7 4 .5-3 2.8.8 4L15 12.5l-3.6 2 .8-4-3-2.8 4-.5z" fill="${b}"/><circle cx="3" cy="9" r="1.3" fill="${a}"/>`);
    case 'sparkle':
      return tile(34, `<path d="M10 2c.6 4 1.9 6.3 6 7-4.1.7-5.4 3-6 7-.6-4-1.9-6.3-6-7 4.1-.7 5.4-3 6-7z" fill="${a}"/><path d="M26 6c.3 2 .9 2.9 3 3.3-2.1.4-2.7 1.3-3 3.3-.3-2-.9-2.9-3-3.3 2.1-.4 2.7-1.3 3-3.3z" fill="${b}"/>`);
    case 'hearts':
      return tile(28, `<path d="M14 14s-5-3-5-6.2C9 6 10.2 5 11.5 5c1.1 0 1.9.6 2.5 1.4C14.6 5.6 15.4 5 16.5 5 17.8 5 19 6 19 7.8 19 11 14 14 14 14z" fill="${a}" opacity=".85"/><circle cx="3" cy="9" r="1.2" fill="${b}"/>`);
    case 'leaf-vine':
      return tile(40, `<path d="M0 10 Q10 4 20 10 T40 10" stroke="${a}" stroke-width="1.6" fill="none"/><path d="M10 7.2c-1-3 1-5 4-5.2-.2 3-2 5-4 5.2z" fill="${a}"/><path d="M30 12.8c1 3-1 5-4 5.2.2-3 2-5 4-5.2z" fill="${b}"/>`);
    case 'dashed':
      return tile(14, `<path d="M1 9h8" stroke="${a}" stroke-width="2" stroke-linecap="round" opacity=".75"/>`);
    case 'thin-rule':
      return center(`<path d="M0 9h300" stroke="${a}" stroke-width="1"/>`);
    case 'double-rule':
      return center(`<path d="M0 6.5h300M0 11.5h300" stroke="${a}" stroke-width="1.1"/>`);
    case 'fleuron':
      return center(`<path d="M0 9h118M182 9h118" stroke="${a}" stroke-width="1.1"/><path d="M150 3l5 6-5 6-5-6z" fill="${a}"/><path d="M144 9c-6-6-14-6-20 0 6 6 14 6 20 0zM156 9c6-6 14-6 20 0-6 6-14 6-20 0z" fill="none" stroke="${b}" stroke-width="1.3"/>`);
    default:
      return { image: 'none', size: 'auto', repeat: 'no-repeat' };
  }
}

/** Corner ornament markup (export only; never inside the editable area). */
export function cornerSvg(p: StylePack): string {
  const a = p.palette.accent;
  const b = p.palette.accent2;
  const paper = p.paper.color;
  switch (p.decor.corner) {
    case 'tape':
      return '<div class="pk-tape" aria-hidden="true"></div>';
    case 'bow':
      return `<svg class="pk-corner" width="54" height="44" viewBox="0 0 54 44" aria-hidden="true"><path d="M27 18C18 6 6 6 6 15s12 9 21 3zM27 18c9-12 21-12 21-3s-12 9-21 3z" fill="${a}" opacity=".9"/><path d="M27 18l-8 22 6-4 2 6zM27 18l8 22-6-4-2 6z" fill="${a}" opacity=".75"/><circle cx="27" cy="18" r="4" fill="${mix(a, '#000000', 0.2)}"/></svg>`;
    case 'leaf':
      return `<svg class="pk-corner" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><path d="M50 6C34 10 18 24 8 50" stroke="${a}" stroke-width="2" fill="none"/><path d="M38 12c-8-2-12 3-12 9 7 1 11-3 12-9zM28 26c-8-1-11 4-11 10 7 0 10-4 11-10zM40 22c2 8-2 12-8 13-1-7 2-11 8-13z" fill="${a}" opacity=".85"/><circle cx="20" cy="18" r="3.2" fill="${b}"/></svg>`;
    case 'star':
      return `<svg class="pk-corner" width="46" height="46" viewBox="0 0 46 46" aria-hidden="true"><path d="M23 4l5.5 11.2 12.3 1.8-8.9 8.7 2.1 12.3L23 32.2 12 38l2.1-12.3-8.9-8.7 12.3-1.8z" fill="${b}" stroke="${p.palette.ink}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    case 'seal':
      return `<svg class="pk-corner" width="50" height="50" viewBox="0 0 50 50" aria-hidden="true"><path d="M25 3l4 3.4 5.2-.9 2 4.9 4.9 2-.9 5.2L44 21l-3.4 4 .9 5.2-4.9 2-2 4.9-5.2-.9L25 40l-4-3.4-5.2.9-2-4.9-4.9-2 .9-5.2L5 21l3.4-4-.9-5.2 4.9-2 2-4.9 5.2.9z" fill="${b}"/><circle cx="25" cy="21.5" r="9" fill="none" stroke="${paper}" stroke-opacity=".55" stroke-width="1.3"/></svg>`;
    case 'sparkle':
      return `<svg class="pk-corner" width="52" height="46" viewBox="0 0 52 46" aria-hidden="true"><path d="M20 4c1.2 8.5 4 12.6 12 14-8 1.4-10.8 5.5-12 14-1.2-8.5-4-12.6-12-14 8-1.4 10.8-5.5 12-14z" fill="${a}"/><path d="M40 24c.6 4 1.9 6 5.8 6.7-3.9.7-5.2 2.7-5.8 6.7-.6-4-1.9-6-5.8-6.7 3.9-.7 5.2-2.7 5.8-6.7z" fill="${b}"/><circle cx="44" cy="10" r="2" fill="${b}"/></svg>`;
    default:
      return '';
  }
}

/** Small header doodle (export only). */
export function doodleSvg(p: StylePack): string {
  const a = p.palette.accent2;
  const k = p.palette.accent;
  const s = (body: string) =>
    `<svg class="pk-doodle" width="44" height="22" viewBox="0 0 44 22" aria-hidden="true">${body}</svg>`;
  switch (p.decor.doodle) {
    case 'stars':
      return s(`<path d="M10 3l1.9 3.9 4.3.6-3.1 3 .7 4.3L10 12.8l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="${a}"/><path d="M30 9l1.1 2.3 2.5.4-1.8 1.7.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.7 2.5-.4z" fill="${k}"/>`);
    case 'hearts':
      return s(`<path d="M11 17s-6-3.6-6-7.4C5 7.6 6.4 6.4 8 6.4c1.3 0 2.3.7 3 1.7.7-1 1.7-1.7 3-1.7 1.6 0 3 1.2 3 3.2 0 3.8-6 7.4-6 7.4z" fill="${k}"/>`);
    case 'leaves':
      return s(`<path d="M4 18C6 9 12 5 20 4c-1 8-7 13-16 14z" fill="${k}"/><path d="M24 18c2-6 6-9 12-10-1 6-5 9.5-12 10z" fill="${a}"/>`);
    case 'sparkles':
      return s(`<path d="M10 2c.8 5.5 2.6 8.2 7.8 9-5.2.8-7 3.5-7.8 9-.8-5.5-2.6-8.2-7.8-9 5.2-.8 7-3.5 7.8-9z" fill="${k}"/><path d="M31 6c.5 3 1.4 4.4 4.2 4.9-2.8.5-3.7 1.9-4.2 4.9-.5-3-1.4-4.4-4.2-4.9 2.8-.5 3.7-1.9 4.2-4.9z" fill="${a}"/>`);
    case 'flowers':
      return s(`<g fill="${a}"><circle cx="11" cy="6.5" r="3"/><circle cx="15.5" cy="11" r="3"/><circle cx="11" cy="15.5" r="3"/><circle cx="6.5" cy="11" r="3"/></g><circle cx="11" cy="11" r="2.3" fill="${k}"/>`);
    default:
      return '';
  }
}
