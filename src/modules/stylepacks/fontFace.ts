/** @font-face generation from validated font data (web-safe, no Expo imports). */
import * as z from 'zod';

import { FONTS, type FontFamily } from './schema';

export interface FontFaceData {
  family: FontFamily;
  weight: 400 | 700;
  style: 'normal' | 'italic';
  base64: string;
}

export const MAX_FONT_BASE64 = 3_000_000;

export const fontFaceDataSchema = z.object({
  family: z.enum(FONTS),
  weight: z.union([z.literal(400), z.literal(700)]),
  style: z.enum(['normal', 'italic']),
  base64: z.string().max(MAX_FONT_BASE64).regex(/^[A-Za-z0-9+/]*={0,2}$/),
});

export function fontFaceCss(faces: readonly FontFaceData[]): string {
  return faces
    .map(
      (f) =>
        `@font-face{font-family:'${f.family}';src:url(data:font/ttf;base64,${f.base64}) format('truetype');font-weight:${f.weight};font-style:${f.style};font-display:block}`,
    )
    .join('\n');
}
