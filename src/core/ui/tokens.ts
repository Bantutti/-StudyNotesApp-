/**
 * App chrome design tokens (plan v0.2 section 9.5).
 *
 * Quiet warm-neutral chrome so the page (style pack) carries the look.
 * The accent is the current subject's colour (default #4F7CF7). Raw plan
 * colours that fail WCAG AA in some role are adjusted by role:
 *  - text on a filled accent uses solidColors() (white text, fill darkened
 *    just enough; the plan's #4F7CF7 gives only 3.78:1 with white),
 *  - accent or status colours used AS TEXT go through ensureContrast(4.5).
 * The P0 `ui` palette stays for the developer (spike) screens until P6.
 */
import { ensureContrast, solidColors } from '../color';

export type Scheme = 'light' | 'dark';

const BASE = {
  light: {
    bg: '#FAF8F5',
    surface: '#FFFFFF',
    text: '#1F2328',
    muted: '#6B7280',
    line: '#E6E1DA',
    success: '#2E9E6A',
    warn: '#D98E04',
    danger: '#D64545',
  },
  dark: {
    bg: '#141416',
    surface: '#1E1E22',
    text: '#ECECEE',
    muted: '#9A9AA3',
    line: '#2E2E34',
    success: '#2E9E6A',
    warn: '#D98E04',
    danger: '#D64545',
  },
} as const;

export const DEFAULT_ACCENT = '#4F7CF7';

export const radius = { chip: 8, input: 12, card: 16, sheet: 24 } as const;
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
export const type = { largeTitle: 28, title: 20, body: 16, caption: 13 } as const;
export const motion = { tap: 150, sheet: 250 } as const;
export const TOUCH_MIN = 44;

export interface Theme {
  scheme: Scheme;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  line: string;
  /** Accent for borders, icons, selection (3:1 on surface). */
  accent: string;
  /** Accent when used as text, e.g. links and selected labels (4.5:1 on surface). */
  accentText: string;
  /** Filled primary buttons: fill and its text colour (4.5:1). */
  primary: { fill: string; text: string };
  success: string;
  warn: string;
  danger: string;
  /** Status colours safe as text on surface (4.5:1). */
  successText: string;
  warnText: string;
  dangerText: string;
  radius: typeof radius;
  space: typeof space;
  type: typeof type;
  motion: typeof motion;
}

export function makeTheme(scheme: Scheme, accent: string = DEFAULT_ACCENT): Theme {
  const b = BASE[scheme];
  return {
    scheme,
    ...b,
    accent: ensureContrast(accent, b.surface, 3),
    accentText: ensureContrast(accent, b.surface, 4.5),
    primary: solidColors(accent),
    successText: ensureContrast(b.success, b.surface, 4.5),
    warnText: ensureContrast(b.warn, b.surface, 4.5),
    dangerText: ensureContrast(b.danger, b.surface, 4.5),
    radius,
    space,
    type,
    motion,
  };
}

/** Preset subject colours (stored without '#', as in the cloud). */
export const SUBJECT_COLORS = [
  '4F7CF7', 'E05A7A', '2E9E6A', 'D98E04', '8B5CF6', '0EA5A4', 'EF6C35', '64748B',
] as const;
