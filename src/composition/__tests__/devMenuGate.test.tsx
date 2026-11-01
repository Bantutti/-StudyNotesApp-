/**
 * Review M4: the developer menu (Groq key screen, voice and timestamps that
 * send audio without the 18+ gate or consent) is unreachable in preview and
 * store builds. Renders the real Me tab and /dev layout with services as in
 * a release build (devTools false).
 */
import { act } from 'react';
import { Alert } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import * as z from 'zod';

import { createLogger, createSeqIdGenerator, memorySink } from '@/core';
import { openStore, type Store } from '@/modules/store';
import { createPackRegistry } from '@/modules/stylepacks';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { KEY_DEV_MENU, KV_APP } from '../appData';

let mockStore: Store;
let mockDevTools = false;
const mockPacks = createPackRegistry();
const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const { Text: T } = jest.requireActual<typeof import('react-native')>('react-native');
  const Stack = Object.assign(() => <T>dev-stack</T>, { Screen: () => null });
  return {
    Redirect: ({ href }: { href: string }) => <T>{`redirect:${href}`}</T>,
    Stack,
    router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
    useFocusEffect: (cb: () => void | (() => void)) => {
      const { useEffect: mockUseEffect } = jest.requireActual<typeof import('react')>('react');
      mockUseEffect(cb, []);
    },
  };
});
jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text: T } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: ({ name }: { name: string }) => <T>{name}</T> };
});
jest.mock('@/composition', () => ({
  ...jest.requireActual<object>('@/composition'),
  useStore: () => mockStore,
  useServices: () => ({ devTools: mockDevTools, packs: mockPacks }),
  useAppData: () => ({ store: mockStore, resetAll: jest.fn() }),
}));

// Imported after the mocks.
// eslint-disable-next-line import/first
import Me from '../../app/(tabs)/me';
// eslint-disable-next-line import/first
import DevLayout from '../../app/dev/_layout';

const texts = (root: Root) => root.container.queryAll((n) => typeof n.children[0] === 'string').map((n) => n.children.join(''));
const byTestId = (root: Root, id: string) => root.container.queryAll((n) => n.props.testID === id);
async function press(el: TestInstance) {
  let f = el.unstable_fiber as { memoizedProps?: { onPress?: () => unknown }; return: unknown } | null;
  while (f && !f.memoizedProps?.onPress) f = f.return as typeof f;
  await act(async () => {
    await f!.memoizedProps!.onPress!();
  });
}
async function render(el: React.ReactElement) {
  const root = createRoot();
  await act(async () => root.render(el));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return root;
}

beforeEach(async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockStore = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }) });
  mockPush.mockClear();
});

describe('developer menu in a release build (devTools false)', () => {
  beforeEach(() => {
    mockDevTools = false;
  });

  it('/dev redirects home even when an earlier dev session stored the unlock (deep links too)', async () => {
    await mockStore.kv.set(KV_APP, KEY_DEV_MENU, true);
    const root = await render(<DevLayout />);
    expect(texts(root)).toContain('redirect:/');
    expect(texts(root)).not.toContain('dev-stack');
    await act(async () => root.unmount());
  });

  it('Me: 7 (or 20) taps on the version unlock nothing and store nothing; no developer row', async () => {
    const root = await render(<Me />);
    const version = byTestId(root, 'me-version')[0]!;
    for (let i = 0; i < 20; i++) await press(version);
    expect(byTestId(root, 'me-dev')).toHaveLength(0);
    expect(await mockStore.kv.get(KV_APP, KEY_DEV_MENU, z.boolean())).toBeNull();
    await act(async () => root.unmount());
  });

  it('Me: a stored unlock does not show the developer row', async () => {
    await mockStore.kv.set(KV_APP, KEY_DEV_MENU, true);
    const root = await render(<Me />);
    expect(byTestId(root, 'me-dev')).toHaveLength(0);
    await act(async () => root.unmount());
  });
});

describe('developer menu in dev mode (devTools true)', () => {
  beforeEach(() => {
    mockDevTools = true;
  });

  it('7 taps unlock it, the row appears, and /dev opens', async () => {
    const root = await render(<Me />);
    const version = byTestId(root, 'me-version')[0]!;
    for (let i = 0; i < 7; i++) await press(version);
    expect(byTestId(root, 'me-dev')).toHaveLength(1);
    await act(async () => root.unmount());
    const dev = await render(<DevLayout />);
    expect(texts(dev)).toContain('dev-stack');
    await act(async () => dev.unmount());
  });
});

