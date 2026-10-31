/**
 * Style pack schema v3 (TypeScript port of StylePacks_v3/schema.js).
 *
 * A pack is DATA, never code: enums, #RRGGBB colours, bundled OFL fonts and
 * numbers inside fixed ranges. Unknown fields are rejected (strict objects).
 * Free-text fields cannot contain markup, CSS or URLs.
 */
import * as z from 'zod';

export const FONTS = [
  'Gaegu', 'Nunito', 'Itim', 'Lexend', 'Gowun Dodum', 'Nanum Gothic',
  'Cormorant Garamond', 'EB Garamond', 'Cinzel', 'Crimson Pro', 'Fredoka',
  'Patrick Hand', 'Delius Swash Caps', 'Delius', 'Dancing Script', 'Mulish',
  'Mochiy Pop One', 'Zen Maru Gothic', 'Atkinson Hyperlegible', 'Caveat',
  'Quicksand', 'Kalam',
] as const;
export type FontFamily = (typeof FONTS)[number];

export const ENUMS = {
  paperType: ['lined', 'grid', 'dotted', 'plain'],
  paperMargin: ['none', 'left', 'double'],
  texture: ['none', 'grain', 'chalk'],
  headerCase: ['normal', 'upper', 'smallcaps'],
  headerStyle: [
    'highlight-swipe', 'underline-swipe', 'ribbon-banner', 'washi-tape', 'bubble-outline',
    'small-caps-rule', 'tab-label', 'gold-underline', 'bow-underline', 'sticker-label', 'bold-block',
  ],
  divider: [
    'squiggle', 'dots', 'stars', 'fleuron', 'leaf-vine', 'hearts',
    'thin-rule', 'double-rule', 'dashed', 'sparkle', 'none',
  ],
  callout: ['bubble', 'sticky-note', 'bordered', 'side-bar', 'ticket', 'scroll'],
  definition: ['boxed', 'dashed-box', 'tab-box', 'index-card', 'framed'],
  bullet: ['dot', 'dash', 'star', 'heart', 'leaf', 'arrow', 'square', 'seal', 'check'],
  washi: ['none', 'stripes', 'dots', 'gingham', 'plain'],
  corner: ['none', 'tape', 'bow', 'leaf', 'star', 'seal', 'sparkle'],
  doodle: ['none', 'stars', 'hearts', 'leaves', 'sparkles', 'flowers'],
  appearance: ['light', 'dark'],
  tier: ['launch', 'extra'],
  keyPosition: ['top', 'bottom'],
  margin: ['narrow', 'medium', 'wide'],
  bodySize: ['s', 'm', 'l'],
} as const;

export const MAX_STR = 160;
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const UNSAFE = /[<>{}]|url\(|https?:|javascript:|@import|;/i;

const id = z.string().regex(ID);
const text = z.string().max(MAX_STR).refine((s) => !UNSAFE.test(s), 'contains markup, CSS or a URL');
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const font = z.enum(FONTS);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const num = (min: number, max: number) => z.number().min(min).max(max);

export const stylePackSchema = z.strictObject({
  schema: z.literal(3),
  id,
  version: int(1, 999),
  name: text,
  meta: z.strictObject({
    mood: text,
    bestFor: text,
    trend: text,
    appearance: z.enum(ENUMS.appearance),
    tier: z.enum(ENUMS.tier),
  }),
  paper: z.strictObject({
    type: z.enum(ENUMS.paperType),
    color: hex,
    line: hex,
    lineGap: int(22, 34),
    margin: z.enum(ENUMS.paperMargin),
    texture: z.enum(ENUMS.texture),
  }),
  fonts: z.strictObject({
    header: font,
    body: font,
    headerWeight: int(400, 800),
    headerItalic: z.boolean(),
    headerCase: z.enum(ENUMS.headerCase),
    headerScale: num(1.5, 2.8),
    bodySize: z.enum(ENUMS.bodySize),
  }),
  palette: z.strictObject({ ink: hex, accent: hex, accent2: hex, muted: hex, soft: hex }),
  highlighters: z
    .array(z.strictObject({ id, color: hex, opacity: num(0.25, 1), meaning: text }))
    .min(1)
    .max(6),
  highlightKey: z.strictObject({ show: z.boolean(), position: z.enum(ENUMS.keyPosition) }),
  header: z.strictObject({ style: z.enum(ENUMS.headerStyle), divider: z.enum(ENUMS.divider) }),
  blocks: z.strictObject({
    callout: z.enum(ENUMS.callout),
    definition: z.enum(ENUMS.definition),
    bullet: z.enum(ENUMS.bullet),
  }),
  decor: z.strictObject({
    washi: z.enum(ENUMS.washi),
    corner: z.enum(ENUMS.corner),
    doodle: z.enum(ENUMS.doodle),
  }),
  ink: z.strictObject({ pens: z.tuple([hex, hex, hex]), highlighter: hex }),
  layout: z.strictObject({ columns: int(1, 2), margin: z.enum(ENUMS.margin) }),
});

export type StylePack = z.infer<typeof stylePackSchema>;
