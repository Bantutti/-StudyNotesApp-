/** @font-face generation from validated font data (web-safe, no Expo imports). */
import * as z from 'zod';

import { FONTS, type FontFamily } from './schema';

export interface FontFaceData {
  family: FontFamily;
  weight: 400 | 700;
  style: 'normal' | 'italic';
  base64: string;
}

/**
 * Largest accepted font face, in base64 characters (validated on both sides of the bridge).
 * 4.5 M fits Gaegu (Pastel Highlight's header font, the default pack): Gaegu_400Regular is
 * 4,219,900 chars, Gaegu_700Bold 3,949,040. Trade-off: a WebView may now hold ~8.5 MB of font
 * CSS for that pack (still under the 6 M-char bridge limit per message, as faces are sent one
 * per message). TODO(P5): replace Gaegu with a Latin subset and lower this cap again.
 */
export const MAX_FONT_BASE64 = 4_500_000;

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
