import { act } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { ThemeProvider } from '@/core/ui';
import NewSheet from '@/app/new';
import Home from '@/app/(tabs)/home';
import NoteScreen from '@/app/note/[id]';

let mockFocused = true;
let mockRemoteChange: () => void = () => {};
const mockPush = jest.fn();
const mockDismiss = jest.fn();
const mockReplace = jest.fn();
const mockCreate = jest.fn();
const mockGet = jest.fn();
const mockRemember = jest.fn();
const mockSummary = jest.fn();
const mockStore = { notes: { get: mockGet } };
const mockSession = {
  dispose: jest.fn(), setLiveSource: jest.fn(), changedElsewhere: jest.fn(() => false),
  shown: jest.fn(), seen: jest.fn(), leave: jest.fn(() => Promise.resolve()),
  flush: jest.fn(() => Promise.resolve()), latestDoc: null,
};
const mockInk = { leave: jest.fn(() => Promise.resolve()), flush: jest.fn() };
const mockLogger = { warn: jest.fn() };

jest.mock('expo-router', () => {
  // Jest mock factories are hoisted and must load React inside the factory.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args), dismiss: () => mockDismiss(), replace: (...args: unknown[]) => mockReplace(...args) },
    useFocusEffect: (fn: () => void | (() => void)) => {
      const focused = mockFocused;
      React.useEffect(() => focused ? fn() : undefined, [fn, focused]);
    },
    useLocalSearchParams: () => ({ id: 'note-1' }),
    Stack: { Screen: () => null },
  };
});
jest.mock('@expo/vector-icons/Ionicons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return { __esModule: true, default: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/composition', () => ({
  useStore: () => mockStore,
  useAppData: () => ({ store: mockStore, showActionUndo: jest.fn(), showUndo: jest.fn() }),
  useDataVersion: () => 0,
  createNoteIn: (...args: unknown[]) => mockCreate(...args),
  homeSummary: (...args: unknown[]) => mockSummary(...args),
  examLabel: () => '',
  createNoteSession: () => mockSession,
  rememberOpenedNote: (...args: unknown[]) => mockRemember(...args),
  usePackFaces: () => ({ pack: {}, faces: [] }),
  useServices: () => ({ editorActions: {}, ids: {}, links: jest.fn(), logger: mockLogger }),
  useNoteSync: (_id: string, onRemoteChange: () => void) => { mockRemoteChange = onRemoteChange; return { edited: jest.fn() }; },
  displayTitle: () => 'Note',
}));
jest.mock('@/screens/SyncChip', () => ({ NeedsAttentionBanner: () => null, SyncChip: () => null }));
jest.mock('@/screens/NoteCard', () => ({ NoteCard: () => null }));
jest.mock('@/screens/EditorToolbar', () => ({ EditorToolbar: () => null }));
jest.mock('@/screens/editorActionHooks', () => ({ useEditorActionRunner: () => ({ busy: false, run: jest.fn() }) }));
jest.mock('@/screens/EditorSheets', () => ({ BlockMenuSheet: () => null, InfoSheet: () => null, LinkSheet: () => null }));
jest.mock('@/screens/NoteInk', () => ({
  NoteInkBar: () => null, NoteInkOverlay: () => null, useIsTablet: () => false,
  useNoteInk: () => ({ ink: mockInk, state: { drawMode: false } }),
}));
jest.mock('@/modules/editor', () => ({ EditorView: () => null }));

const summary = { exams: [], hasAnyNote: false, continueNote: null, recent: [] };
const note = { id: 'note-1', title: 'Test', deleted: false, updated: 1, document: { type: 'doc', content: [] }, stylePackId: 'default', subject: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function render(Component: typeof NewSheet): Promise<Root> {
  const root = createRoot();
  await act(async () => { root.render(<ThemeProvider scheme="light"><Component /></ThemeProvider>); });
  return root;
}
function button(root: Root, id: string): TestInstance {
  const nodes = root.container.queryAll((n) => n.props.testID === id && n.props.accessibilityRole === 'button');
  expect(nodes).toHaveLength(1);
  return nodes[0]!;
}
function pressHandler(el: TestInstance): () => void {
  let fiber = el.unstable_fiber as { memoizedProps?: { onPress?: () => void }; return: unknown } | null;
  while (fiber && !fiber.memoizedProps?.onPress) fiber = fiber.return as typeof fiber;
  expect(fiber?.memoizedProps?.onPress).toBeDefined();
  return fiber!.memoizedProps!.onPress!;
}
async function unmount(root: Root) { await act(async () => root.unmount()); }

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  mockGet.mockReset();
  mockRemember.mockReset();
  mockSummary.mockReset();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockFocused = true;
  mockRemoteChange = () => {};
  mockSummary.mockResolvedValue(summary);
  mockRemember.mockResolvedValue(undefined);
  mockGet.mockResolvedValue(note);
});

describe('new-note navigation safety', () => {
  it.each([['sheet', NewSheet, 'new-note'], ['home', Home, 'home-first-note']] as const)('blocks synchronous repeated presses on %s', async (_name, Screen, id) => {
    const pending = deferred<{ id: string }>();
    mockCreate.mockReturnValue(pending.promise);
    const root = await render(Screen);
    await act(async () => {
      const press = pressHandler(button(root, id));
      press(); press();
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(button(root, id).props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await act(async () => pending.resolve({ id: 'created' }));
    const navigate = Screen === NewSheet ? mockReplace : mockPush;
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ pathname: '/note/[id]', params: { id: 'created' } });
    expect(mockDismiss).not.toHaveBeenCalled();
    await unmount(root);
  });
});

describe('creation errors and lifecycle', () => {
  it.each([['sheet', NewSheet, 'new-note'], ['home', Home, 'home-first-note']] as const)('%s reports failure and can retry', async (_name, Screen, id) => {
    mockCreate.mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValueOnce({ id: 'retry-note' });
    const root = await render(Screen);
    await act(async () => { pressHandler(button(root, id))(); });
    expect(root.container.queryAll((n) => typeof n.props.children === 'string' && n.props.children.includes('Could not create note'))).not.toHaveLength(0);
    expect(button(root, id).props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    await act(async () => { pressHandler(button(root, id))(); });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(Screen === Home ? mockPush : mockReplace).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it.each([['sheet', NewSheet, 'new-note'], ['home', Home, 'home-first-note']] as const)('%s suppresses late navigation after unmount', async (_name, Screen, id) => {
    const pending = deferred<{ id: string }>();
    mockCreate.mockReturnValue(pending.promise);
    const root = await render(Screen);
    await act(async () => { pressHandler(button(root, id))(); });
    await unmount(root);
    await act(async () => pending.resolve({ id: 'saved-late' }));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('does not navigate after a blur and refocus while creation is still pending', async () => {
    const pending = deferred<{ id: string }>();
    mockCreate.mockReturnValue(pending.promise);
    const root = await render(Home);
    await act(async () => { pressHandler(button(root, 'home-first-note'))(); });
    mockFocused = false;
    await act(async () => { root.render(<ThemeProvider scheme="light"><Home /></ThemeProvider>); });
    mockFocused = true;
    await act(async () => { root.render(<ThemeProvider scheme="light"><Home /></ThemeProvider>); });
    await act(async () => pending.resolve({ id: 'saved-late' }));
    expect(mockPush).not.toHaveBeenCalled();
    expect(button(root, 'home-first-note').props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    await unmount(root);
  });

  it('reports a synchronous creation exception and permits another attempt', async () => {
    mockCreate.mockImplementationOnce(() => { throw new Error('sync failure'); }).mockResolvedValueOnce({ id: 'retry' });
    const root = await render(Home);
    await act(async () => { pressHandler(button(root, 'home-first-note'))(); });
    expect(root.container.queryAll((n) => typeof n.props.children === 'string' && n.props.children.includes('Could not create note'))).not.toHaveLength(0);
    await act(async () => { pressHandler(button(root, 'home-first-note'))(); });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('reports a pending failure after refocus and releases the lock', async () => {
    const pending = deferred<{ id: string }>();
    mockCreate.mockReturnValueOnce(pending.promise);
    const root = await render(Home);
    await act(async () => { pressHandler(button(root, 'home-first-note'))(); });
    mockFocused = false;
    await act(async () => root.render(<ThemeProvider scheme="light"><Home /></ThemeProvider>));
    mockFocused = true;
    await act(async () => root.render(<ThemeProvider scheme="light"><Home /></ThemeProvider>));
    await act(async () => pending.reject(new Error('late failure')));
    expect(root.container.queryAll((n) => typeof n.props.children === 'string' && n.props.children.includes('Could not create note'))).not.toHaveLength(0);
    expect(button(root, 'home-first-note').props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    expect(mockPush).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('ignores a creation failure after unmount', async () => {
    const pending = deferred<{ id: string }>();
    mockCreate.mockReturnValueOnce(pending.promise);
    const root = await render(NewSheet);
    await act(async () => { pressHandler(button(root, 'new-note'))(); });
    await unmount(root);
    await act(async () => pending.reject(new Error('late failure')));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('reports navigation failure without offering a second creation', async () => {
    mockCreate.mockResolvedValue({ id: 'saved' });
    mockPush.mockImplementationOnce(() => { throw new Error('synthetic navigation failure'); });
    const root = await render(Home);
    await act(async () => { pressHandler(button(root, 'home-first-note'))(); });
    expect(root.container.queryAll((n) => typeof n.props.children === 'string' && n.props.children.includes('Note created, but could not be opened'))).not.toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('holds the successful creation lock until focus is lost', async () => {
    mockCreate.mockResolvedValue({ id: 'saved' });
    const root = await render(Home);
    const press = pressHandler(button(root, 'home-first-note'));
    await act(async () => { press(); });
    await act(async () => { press(); });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    mockFocused = false;
    await act(async () => root.render(<ThemeProvider scheme="light"><Home /></ThemeProvider>));
    mockFocused = true;
    await act(async () => root.render(<ThemeProvider scheme="light"><Home /></ThemeProvider>));
    expect(button(root, 'home-first-note').props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    await unmount(root);
  });

  it('protects the home quick action when notes exist', async () => {
    mockSummary.mockResolvedValue({ ...summary, hasAnyNote: true });
    const pending = deferred<{ id: string }>();
    mockCreate.mockReturnValue(pending.promise);
    const root = await render(Home);
    await act(async () => { const press = pressHandler(button(root, 'home-new-note')); press(); press(); });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(button(root, 'home-new-note').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await act(async () => pending.resolve({ id: 'saved' }));
    expect(mockPush).toHaveBeenCalledTimes(1);
    await unmount(root);
  });
});

describe('note screen load failure', () => {
  it('offers retry for a rejected initial load and opens the note on retry', async () => {
    mockGet.mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(note);
    const root = await render(NoteScreen);
    expect(button(root, 'note-load-retry')).toBeDefined();
    expect(mockRemember).not.toHaveBeenCalled();
    await act(async () => { pressHandler(button(root, 'note-load-retry'))(); });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(root.container.queryAll((n) => n.props.testID === 'note-title')).not.toHaveLength(0);
    expect(mockRemember).toHaveBeenCalledWith(mockStore, note.id);
    await unmount(root);
  });

  it('treats a synchronous read exception as a recoverable load error', async () => {
    mockGet.mockImplementationOnce(() => { throw new Error('sync read failed'); }).mockResolvedValueOnce(note);
    const root = await render(NoteScreen);
    expect(button(root, 'note-load-retry')).toBeDefined();
    expect(root.container.queryAll((n) => n.props.children === 'This note no longer exists.')).toHaveLength(0);
    await act(async () => { pressHandler(button(root, 'note-load-retry'))(); });
    expect(root.container.queryAll((n) => n.props.testID === 'note-title')).not.toHaveLength(0);
    await unmount(root);
  });

  it.each([null, { ...note, deleted: true }])('only reports missing for an actual missing/deleted result', async (result) => {
    mockGet.mockResolvedValueOnce(result);
    const root = await render(NoteScreen);
    expect(root.container.queryAll((n) => n.props.children === 'This note no longer exists.')).not.toHaveLength(0);
    expect(root.container.queryAll((n) => n.props.testID === 'note-load-retry')).toHaveLength(0);
    await unmount(root);
  });

  it('retains the existing editor on a failed focus refresh and retries without leaving again', async () => {
    mockGet.mockResolvedValueOnce(note).mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValueOnce(note);
    const root = await render(NoteScreen);
    mockFocused = false;
    await act(async () => root.render(<ThemeProvider scheme="light"><NoteScreen /></ThemeProvider>));
    mockFocused = true;
    await act(async () => root.render(<ThemeProvider scheme="light"><NoteScreen /></ThemeProvider>));
    expect(button(root, 'note-load-retry')).toBeDefined();
    expect(root.container.queryAll((n) => n.props.testID === 'note-title')).not.toHaveLength(0);
    const leaves = mockSession.leave.mock.calls.length;
    await act(async () => { pressHandler(button(root, 'note-load-retry'))(); });
    expect(mockSession.leave).toHaveBeenCalledTimes(leaves);
    expect(root.container.queryAll((n) => n.props.testID === 'note-load-retry')).toHaveLength(0);
    await unmount(root);
  });

  it('reports a remote-refresh read failure without replacing the open editor', async () => {
    mockGet.mockResolvedValueOnce(note).mockRejectedValueOnce(new Error('remote read failed')).mockResolvedValueOnce(note);
    const root = await render(NoteScreen);
    await act(async () => { mockRemoteChange(); });
    expect(root.container.queryAll((n) => n.props.testID === 'note-title')).not.toHaveLength(0);
    expect(button(root, 'note-load-retry')).toBeDefined();
    await act(async () => { pressHandler(button(root, 'note-load-retry'))(); });
    expect(root.container.queryAll((n) => n.props.testID === 'note-load-retry')).toHaveLength(0);
    await unmount(root);
  });

  it('ignores a rejected load after leaving the screen', async () => {
    const pending = deferred<typeof note>();
    mockGet.mockReturnValueOnce(pending.promise);
    const root = await render(NoteScreen);
    await unmount(root);
    await act(async () => pending.reject(new Error('late read failure')));
    expect(mockRemember).not.toHaveBeenCalled();
  });

  it('does not show a prior missing result while a refocus read is pending or failed', async () => {
    const pending = deferred<typeof note>();
    mockGet.mockResolvedValueOnce(null).mockReturnValueOnce(pending.promise);
    const root = await render(NoteScreen);
    expect(root.container.queryAll((n) => n.props.children === 'This note no longer exists.')).not.toHaveLength(0);
    mockFocused = false;
    await act(async () => root.render(<ThemeProvider scheme="light"><NoteScreen /></ThemeProvider>));
    mockFocused = true;
    await act(async () => root.render(<ThemeProvider scheme="light"><NoteScreen /></ThemeProvider>));
    expect(root.container.queryAll((n) => n.props.children === 'This note no longer exists.')).toHaveLength(0);
    await act(async () => pending.reject(new Error('read failed')));
    expect(button(root, 'note-load-retry')).toBeDefined();
    expect(root.container.queryAll((n) => n.props.children === 'This note no longer exists.')).toHaveLength(0);
    await unmount(root);
  });

  it('uses the latest overlapping read, ignoring a stale missing result', async () => {
    const first = deferred<typeof note | null>();
    const second = deferred<typeof note | null>();
    mockGet.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const root = await render(NoteScreen);
    await act(async () => { mockRemoteChange(); });
    await act(async () => second.resolve(note));
    expect(root.container.queryAll((n) => n.props.testID === 'note-title')).not.toHaveLength(0);
    expect(mockRemember).toHaveBeenCalledWith(mockStore, note.id);
    await act(async () => first.resolve(null));
    expect(root.container.queryAll((n) => n.props.testID === 'note-title')).not.toHaveLength(0);
    expect(root.container.queryAll((n) => n.props.children === 'This note no longer exists.')).toHaveLength(0);
    await unmount(root);
  });

  it('ignores an older retry failure after a newer retry succeeds on the same focus', async () => {
    const older = deferred<typeof note>();
    const newer = deferred<typeof note>();
    mockGet.mockRejectedValueOnce(new Error('initial')).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const root = await render(NoteScreen);
    await act(async () => {
      const retry = pressHandler(button(root, 'note-load-retry'));
      retry(); retry();
    });
    await act(async () => newer.resolve(note));
    await act(async () => older.reject(new Error('stale failure')));
    expect(root.container.queryAll((n) => n.props.testID === 'note-load-retry')).toHaveLength(0);
    expect(root.container.queryAll((n) => n.props.testID === 'note-title')).not.toHaveLength(0);
    await unmount(root);
  });

  it('ignores an older remote read failure after a newer refocus succeeds', async () => {
    const remote = deferred<typeof note>();
    mockGet.mockResolvedValueOnce(note).mockReturnValueOnce(remote.promise).mockResolvedValueOnce(note);
    const root = await render(NoteScreen);
    await act(async () => { mockRemoteChange(); });
    mockFocused = false;
    await act(async () => root.render(<ThemeProvider scheme="light"><NoteScreen /></ThemeProvider>));
    mockFocused = true;
    await act(async () => root.render(<ThemeProvider scheme="light"><NoteScreen /></ThemeProvider>));
    await act(async () => remote.reject(new Error('stale failure')));
    expect(root.container.queryAll((n) => n.props.testID === 'note-load-retry')).toHaveLength(0);
    expect(root.container.queryAll((n) => n.props.testID === 'note-title')).not.toHaveLength(0);
    await unmount(root);
  });

  it('handles remembered-note failure separately from a successful load', async () => {
    mockRemember.mockRejectedValueOnce(new Error('remember failed'));
    const root = await render(NoteScreen);
    expect(root.container.queryAll((n) => n.props.testID === 'note-title')).not.toHaveLength(0);
    expect(root.container.queryAll((n) => n.props.testID === 'note-load-retry')).toHaveLength(0);
    expect(mockLogger.warn).toHaveBeenCalledWith('note.remember_opened_failed');
    await unmount(root);
  });
});
