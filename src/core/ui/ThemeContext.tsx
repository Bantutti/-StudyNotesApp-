/**
 * Theme for app chrome: follows the system light/dark setting; the accent
 * is the current subject's colour when a screen wraps itself in
 * <AccentProvider color="…">. Pages (notes) use their style pack instead.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { DEFAULT_ACCENT, makeTheme, type Scheme, type Theme } from './tokens';

const Ctx = createContext<Theme>(makeTheme('light'));

export function ThemeProvider({ children, scheme }: { children: ReactNode; scheme?: Scheme }) {
  const system = useColorScheme();
  const s: Scheme = scheme ?? (system === 'dark' ? 'dark' : 'light');
  const theme = useMemo(() => makeTheme(s), [s]);
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

/** Re-themes its children with a subject colour ("4F7CF7" or "#4F7CF7"). */
export function AccentProvider({ color, children }: { color: string | null | undefined; children: ReactNode }) {
  const base = useContext(Ctx);
  const hex = color ? `#${color.replace(/^#/, '')}` : DEFAULT_ACCENT;
  const theme = useMemo(() => (/^#[0-9a-fA-F]{6}$/.test(hex) ? makeTheme(base.scheme, hex) : base), [base, hex]);
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export function useTheme(): Theme {
  return useContext(Ctx);
}
