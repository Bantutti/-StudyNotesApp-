/**
 * Draw-mode toolbar: phone bar and tablet floating pill render every control
 * with an accessibility label and call back with the right tool changes.
 */
import { act } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import { ThemeProvider } from '@/core/ui';

import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DEFAULT_TOOLS, type InkToolState } from '../controller';
import { InkToolbar, type InkToolbarProps } from '../ui/InkToolbar';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const Glyph = ({ name }: { name: string }) => <Text>{name}</Text>;
  return { __esModule: true, default: Glyph };
});

const mounted: Root[] = [];
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
});

function render(over: Partial<InkToolbarProps> = {}) {
  const calls: Partial<InkToolState>[] = [];
  const events: string[] = [];
  const props: InkToolbarProps = {
    variant: 'bar',
    side: 'right',
    tools: DEFAULT_TOOLS,
    pens: ['#111111', '#B42318', '#1E6B3A'],
    highlighter: '#FFE98A',
    canUndo: true,
    canRedo: false,
    hasSelection: false,
    onTools: (p) => calls.push(p),
    onUndo: () => events.push('undo'),
    onRedo: () => events.push('redo'),
    onMore: () => events.push('more'),
    onDone: () => events.push('done'),
    onDeleteSelection: () => events.push('delete'),
    onRecolourSelection: () => events.push('recolour'),
    onClearSelection: () => events.push('clear'),
    onSide: (s) => events.push(`side:${s}`),
    ...over,
  };
  let root!: Root;
  act(() => {
    root = createRoot();
    mounted.push(root);
    root.render(
      <GestureHandlerRootView>
        <ThemeProvider>
          <InkToolbar {...props} />
        </ThemeProvider>
      </GestureHandlerRootView>,
    );
  });
  const byLabel = (label: string): TestInstance => root.container.queryAll((n) => n.props.accessibilityLabel === label)[0] as TestInstance;
  const byId = (id: string): TestInstance => root.container.queryAll((n) => n.props.testID === id)[0] as TestInstance;
  return { calls, events, byLabel, byId, root };
}

/** Presses an element: walks up to the nearest onPress, like P1's toolbar test. */
function press(el: TestInstance | undefined) {
  let f = (el as unknown as { unstable_fiber?: { memoizedProps?: { onPress?: () => void }; return: unknown } })?.unstable_fiber ?? null;
  while (f && !f.memoizedProps?.onPress) f = f.return as typeof f;
  expect(f?.memoizedProps?.onPress).toBeDefined();
  act(() => f!.memoizedProps!.onPress!());
}

describe('InkToolbar', () => {
  it('selects pens, the highlighter, the lasso, and cycles widths', () => {
    const { calls, byLabel, byId } = render();
    press(byLabel('Pen 2'));
    press(byLabel('Highlighter'));
    press(byId('ink-lasso'));
    press(byId('ink-width'));
    expect(calls).toEqual([{ tool: 'pen', pen: 1, custom: null }, { tool: 'hl' }, { tool: 'lasso' }, { width: 2 }]);
  });

  it('tapping the active eraser switches whole-stroke / partial erasing', () => {
    const { calls, byId } = render({ tools: { ...DEFAULT_TOOLS, tool: 'eraser' } });
    press(byId('ink-eraser'));
    expect(calls).toEqual([{ eraserMode: 'partial' }]);
  });

  it('shows selection actions only with a selection; undo/redo/done call back', () => {
    const plain = render();
    expect(plain.byId('ink-sel-delete')).toBeUndefined();
    const sel = render({ hasSelection: true });
    press(sel.byId('ink-sel-delete'));
    press(sel.byId('ink-sel-recolour'));
    press(sel.byId('ink-undo'));
    press(sel.byId('ink-done'));
    expect(sel.events).toEqual(['delete', 'recolour', 'undo', 'done']);
  });

  it('renders the floating pill for tablets with a labelled drag handle', () => {
    const { byLabel, byId } = render({ variant: 'floating', side: 'left' });
    expect(byId('ink-toolbar')).toBeDefined();
    expect(byLabel('Move the drawing toolbar')).toBeDefined();
  });
});
