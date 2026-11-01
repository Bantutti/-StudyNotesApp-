/**
 * The page's font faces. Native sends a pack's faces one per setFonts message
 * (a single message would exceed MAX_BRIDGE_CHARS for Pastel Highlight's
 * Gaegu): the first message replaces the list, later ones (append: true) add
 * to it. Every face is validated; at most MAX_FACES are kept.
 */
import { fontFaceCss, fontFaceDataSchema, type FontFaceData } from '../../src/modules/stylepacks/web';

export const MAX_FACES = 12;

export function createFontState() {
  let faces: FontFaceData[] = [];
  return {
    /** Returns the CSS for all faces so far, or null when the message is invalid (nothing changes). */
    apply(input: readonly unknown[], append: boolean): string | null {
      const parsed: FontFaceData[] = [];
      for (const f of input) {
        const r = fontFaceDataSchema.safeParse(f);
        if (!r.success) return null;
        parsed.push(r.data);
      }
      const next = append ? [...faces, ...parsed] : parsed;
      if (next.length > MAX_FACES) return null;
      faces = next;
      return fontFaceCss(faces);
    },
    get count() {
      return faces.length;
    },
  };
}
