/**
 * Tiny rendering helpers on P1's test-renderer (no new dependency).
 * Not a test file (jest runs *.test.tsx only).
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import { ThemeProvider } from '@/core/ui';

export async function render(el: ReactElement): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(<ThemeProvider scheme="light">{el}</ThemeProvider>);
  });
  return root;
}

export async function unmount(root: Root) {
  await act(async () => root.unmount());
}

/** Host elements with this testID (deepest only, so wrappers don't double count). */
export const byTestId = (root: Root | TestInstance, id: string): TestInstance[] =>
  ('container' in root ? root.container : root).queryAll((n) => n.props.testID === id, { matchDeepestOnly: true });

export function one(root: Root | TestInstance, id: string): TestInstance {
  const found = byTestId(root, id);
  if (found.length === 0) throw new Error(`no element with testID ${id}`);
  return found[0] as TestInstance;
}

/** Every visible string in the tree, joined (for "the screen says ..." checks). */
export function allText(root: Root | TestInstance): string {
  const out: string[] = [];
  const walk = (n: TestInstance | string) => {
    if (typeof n === 'string') return void out.push(n);
    n.children.forEach(walk);
  };
  walk('container' in root ? root.container : root);
  return out.join(' ');
}

/** Calls the nearest prop `name` on the element or an ancestor component (what a tap / edit does). */
export async function fire(el: TestInstance, name: 'onPress' | 'onChangeText' | 'onValueChange', ...args: unknown[]) {
  type F = { memoizedProps?: Record<string, unknown>; return: F | null } | null;
  let f = el.unstable_fiber as F;
  while (f && typeof f.memoizedProps?.[name] !== 'function') f = f.return;
  const fn = f?.memoizedProps?.[name] as ((...a: unknown[]) => unknown) | undefined;
  if (!fn) throw new Error(`no ${name} handler`);
  await act(async () => {
    await fn(...args);
  });
}

/** Lets async handlers settle inside act(). */
export async function settle(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setImmediate(r));
    });
  }
}

/** Whether an element (or its pressable ancestor) is disabled. */
export function isDisabled(el: TestInstance): boolean {
  type F = { memoizedProps?: Record<string, unknown>; return: F | null } | null;
  let f = el.unstable_fiber as F;
  while (f) {
    const p = f.memoizedProps;
    if (p && (p.disabled === true || (p.accessibilityState as { disabled?: boolean } | undefined)?.disabled === true)) return true;
    if (p && typeof p.onPress === 'function') return false;
    f = f.return;
  }
  return false;
}
