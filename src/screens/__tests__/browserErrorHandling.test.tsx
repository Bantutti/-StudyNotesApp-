import { act, type ReactElement } from 'react';
import { Alert } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { ThemeProvider } from '@/core/ui';
import NoteActions from '@/app/note-actions';
import Subjects from '@/app/(tabs)/subjects';
import { NoteBrowser } from '@/screens/NoteBrowser';

let mockFocused = true;
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockUndo = jest.fn();
const mockCreate = jest.fn();
const mockGet = jest.fn();
const mockSave = jest.fn();
const mockNoteRemove = jest.fn();
const mockNotes = jest.fn();
const mockCounts = jest.fn();
const mockTags = jest.fn();
const mockSubjects = jest.fn();
const mockSubjectRemove = jest.fn();
const mockFolders = jest.fn();
const mockFolderRemove = jest.fn();
const mockTemplateDeps = { templates: { get: jest.fn() }, ids: {} };
const mockStore = {
  notes: { get: mockGet, save: mockSave, remove: mockNoteRemove, list: mockNotes, counts: mockCounts, tags: mockTags },
  subjects: { list: mockSubjects, remove: mockSubjectRemove },
  folders: { list: mockFolders, remove: mockFolderRemove },
};

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args), back: () => mockBack() },
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
  useAppData: () => ({ store: mockStore, showUndo: mockUndo }),
  useDataVersion: () => 0,
  useTemplateDeps: () => mockTemplateDeps,
  createNoteIn: (...args: unknown[]) => mockCreate(...args),
  displayTitle: () => 'Note',
  SAMPLE_TAG: 'sample',
}));
jest.mock('@/screens/NoteCard', () => ({ NoteCard: () => null }));

const note = { id: 'note-1', title: 'Note', subject: null, deleted: false };
const subject = { id: 'subject-1', name: 'Mathematics', color: '123456' };
const folder = { id: 'folder-1', name: 'Lecture notes', subject: 'subject-1' };
const token = { kind: 'synthetic' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function render(element: ReactElement): Promise<Root> {
  const root = createRoot();
  await act(async () => { root.render(<ThemeProvider scheme="light">{element}</ThemeProvider>); });
  return root;
}
async function rerender(root: Root, element: ReactElement) {
  await act(async () => { root.render(<ThemeProvider scheme="light">{element}</ThemeProvider>); });
}
async function unmount(root: Root) { await act(async () => root.unmount()); }
function element(root: Root, id: string): TestInstance {
  const nodes = root.container.queryAll((n) => n.props.testID === id && n.props.accessibilityRole === 'button');
  expect(nodes).toHaveLength(1);
  return nodes[0]!;
}
function handler(el: TestInstance, name: 'onPress' | 'onLongPress' = 'onPress'): () => void {
  let fiber = el.unstable_fiber as { memoizedProps?: { onPress?: () => void; onLongPress?: () => void }; return: unknown } | null;
  while (fiber && !fiber.memoizedProps?.[name]) fiber = fiber.return as typeof fiber;
  expect(fiber?.memoizedProps?.[name]).toBeDefined();
  return fiber!.memoizedProps![name]!;
}
function contains(root: Root, text: string): boolean {
  const strings = (value: unknown): string => Array.isArray(value) ? value.map(strings).join('') : typeof value === 'string' ? value : '';
  return root.container.queryAll((n) => strings(n.props.children).includes(text)).length > 0;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockFocused = true;
  mockGet.mockResolvedValue(note);
  mockSave.mockResolvedValue(undefined);
  mockNoteRemove.mockResolvedValue(token);
  mockNotes.mockResolvedValue([]);
  mockCounts.mockResolvedValue(new Map());
  mockTags.mockResolvedValue([]);
  mockSubjects.mockResolvedValue([subject]);
  mockSubjectRemove.mockResolvedValue(token);
  mockFolders.mockResolvedValue([folder]);
  mockFolderRemove.mockResolvedValue(token);
  mockCreate.mockResolvedValue({ id: 'created' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('recoverable reads', () => {
  it.each(['note', 'subjects'] as const)('retries a failed note-actions %s read without claiming the note is missing', async (which) => {
    (which === 'note' ? mockGet : mockSubjects).mockRejectedValueOnce(new Error('synthetic read error'));
    const root = await render(<NoteActions />);
    expect(element(root, 'note-actions-load-retry')).toBeDefined();
    expect(contains(root, 'This note no longer exists.')).toBe(false);
    expect(mockBack).not.toHaveBeenCalled();
    await act(async () => { handler(element(root, 'note-actions-load-retry'))(); });
    expect(element(root, 'note-delete')).toBeDefined();
    expect(contains(root, 'Could not load note actions.')).toBe(false);
    await unmount(root);
  });

  it.each([null, { ...note, deleted: true }])('reports a missing note only after a successful read', async (result) => {
    mockGet.mockResolvedValueOnce(result);
    const root = await render(<NoteActions />);
    expect(contains(root, 'This note no longer exists.')).toBe(true);
    await unmount(root);
  });

  it.each(['subjects', 'counts'] as const)('retries a failed subjects %s read rather than showing an empty list', async (which) => {
    (which === 'subjects' ? mockSubjects : mockCounts).mockRejectedValueOnce(new Error('read failed'));
    const root = await render(<Subjects />);
    expect(element(root, 'subjects-load-retry')).toBeDefined();
    expect(contains(root, 'No subjects yet')).toBe(false);
    expect(root.container.queryAll((n) => n.props.testID === 'subjects-inbox')).toHaveLength(0);
    await act(async () => { handler(element(root, 'subjects-load-retry'))(); });
    expect(element(root, 'subject-subject-1')).toBeDefined();
    await unmount(root);
  });

  it.each(['notes', 'folders', 'tags'] as const)('retries a failed browser %s read without showing an empty list', async (which) => {
    const failing = which === 'notes' ? mockNotes : which === 'folders' ? mockFolders : mockTags;
    failing.mockRejectedValueOnce(new Error('read failed'));
    const root = await render(<NoteBrowser subjectId="subject-1" />);
    expect(element(root, 'browser-load-retry')).toBeDefined();
    expect(contains(root, 'Start with a blank page or a template.')).toBe(false);
    await act(async () => { handler(element(root, 'browser-load-retry'))(); });
    expect(element(root, 'folder-folder-1')).toBeDefined();
    expect(contains(root, 'Start with a blank page or a template.')).toBe(true);
    await unmount(root);
  });

  it('handles concurrent rejected and synchronously throwing read ports', async () => {
    mockNotes.mockRejectedValueOnce(new Error('list failed'));
    mockFolders.mockImplementationOnce(() => { throw new Error('folder port threw'); });
    const root = await render(<NoteBrowser subjectId="subject-1" />);
    expect(element(root, 'browser-load-retry')).toBeDefined();
    await unmount(root);
  });

  it('catches synchronous reads and ignores older focus results', async () => {
    const old = deferred<unknown[]>();
    mockNotes.mockReturnValueOnce(old.promise).mockImplementationOnce(() => { throw new Error('sync read error'); }).mockResolvedValueOnce([]);
    const root = await render(<NoteBrowser subjectId="subject-1" />);
    expect(contains(root, 'Loading notes…')).toBe(true);
    mockFocused = false;
    await rerender(root, <NoteBrowser subjectId="subject-1" />);
    mockFocused = true;
    await rerender(root, <NoteBrowser subjectId="subject-1" />);
    expect(element(root, 'browser-load-retry')).toBeDefined();
    await act(async () => old.resolve([]));
    expect(element(root, 'browser-load-retry')).toBeDefined();
    await act(async () => { handler(element(root, 'browser-load-retry'))(); });
    expect(contains(root, 'Start with a blank page or a template.')).toBe(true);
    await unmount(root);
  });
});

describe('destructive actions', () => {
  it('does not navigate or show undo when deleting a note fails, and can retry', async () => {
    mockNoteRemove.mockRejectedValueOnce(new Error('delete failed'));
    const root = await render(<NoteActions />);
    await act(async () => { handler(element(root, 'note-delete'))(); });
    expect(contains(root, 'Could not delete note.')).toBe(true);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockUndo).not.toHaveBeenCalled();
    await act(async () => { handler(element(root, 'note-delete'))(); });
    expect(mockNoteRemove).toHaveBeenCalledWith(['note-1']);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockUndo).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it.each(['move', 'delete'] as const)('does not show undo when subject %s deletion fails', async (mode) => {
    mockSubjectRemove.mockRejectedValueOnce(new Error('delete failed'));
    const root = await render(<Subjects />);
    await act(async () => { handler(element(root, 'subject-subject-1'), 'onLongPress')(); });
    const alerts = jest.mocked(Alert.alert);
    await act(async () => { alerts.mock.calls[0]![2]![2]!.onPress!(); });
    const index = mode === 'move' ? 1 : 2;
    await act(async () => { alerts.mock.calls[1]![2]![index]!.onPress!(); });
    expect(mockSubjectRemove).toHaveBeenCalledWith('subject-1', mode);
    expect(contains(root, 'Could not delete subject.')).toBe(true);
    expect(mockUndo).not.toHaveBeenCalled();
    await unmount(root);
  });

  it.each(['move', 'delete'] as const)('shows undo only after successful subject %s deletion', async (mode) => {
    const root = await render(<Subjects />);
    const alerts = jest.mocked(Alert.alert);
    await act(async () => { handler(element(root, 'subject-subject-1'), 'onLongPress')(); });
    await act(async () => { alerts.mock.calls[0]![2]![2]!.onPress!(); });
    await act(async () => { alerts.mock.calls[1]![2]![mode === 'move' ? 1 : 2]!.onPress!(); });
    expect(mockSubjectRemove).toHaveBeenCalledWith('subject-1', mode);
    expect(mockUndo).toHaveBeenCalledTimes(1);
    expect(mockUndo.mock.calls[0]![1]).toBe(token);
    await unmount(root);
  });

  it('does not show undo when folder deletion fails, and shows it on retry', async () => {
    mockFolderRemove.mockRejectedValueOnce(new Error('delete failed'));
    const root = await render(<NoteBrowser subjectId="subject-1" />);
    const alerts = jest.mocked(Alert.alert);
    await act(async () => { handler(element(root, 'folder-folder-1'), 'onLongPress')(); });
    await act(async () => { alerts.mock.calls[0]![2]![2]!.onPress!(); });
    expect(contains(root, 'Could not delete folder.')).toBe(true);
    expect(mockUndo).not.toHaveBeenCalled();
    await act(async () => { handler(element(root, 'folder-folder-1'), 'onLongPress')(); });
    await act(async () => { alerts.mock.calls[1]![2]![2]!.onPress!(); });
    expect(mockFolderRemove).toHaveBeenCalledWith('folder-1');
    expect(mockUndo).toHaveBeenCalledWith('Folder deleted. Its notes moved up.', token);
    await unmount(root);
  });
});

describe('browser New note', () => {
  it('blocks synchronous presses across both New buttons and preserves subject, folder and template deps', async () => {
    const pending = deferred<{ id: string }>();
    mockCreate.mockReturnValueOnce(pending.promise);
    const root = await render(<NoteBrowser subjectId="subject-1" folderId="folder-1" />);
    await act(async () => {
      handler(element(root, 'browser-new-note'))();
      handler(element(root, 'browser-empty-new-note'))();
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(mockStore, { subject: 'subject-1', folder: 'folder-1' }, {}, mockTemplateDeps);
    expect(element(root, 'browser-new-note').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(element(root, 'browser-empty-new-note').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await act(async () => pending.resolve({ id: 'created' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/note/[id]', params: { id: 'created' } });
    await act(async () => { handler(element(root, 'browser-new-note'))(); });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('reports a failed creation and permits retry in the Inbox', async () => {
    mockCreate.mockRejectedValueOnce(new Error('create failed')).mockResolvedValueOnce({ id: 'retry' });
    const root = await render(<NoteBrowser subjectId={null} />);
    await act(async () => { handler(element(root, 'browser-new-note'))(); });
    expect(contains(root, 'Could not create note.')).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
    expect(element(root, 'browser-new-note').props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    await act(async () => { handler(element(root, 'browser-new-note'))(); });
    expect(mockCreate).toHaveBeenLastCalledWith(mockStore, { subject: null, folder: null }, {}, mockTemplateDeps);
    expect(mockPush).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('does not navigate after blur and refocus during creation', async () => {
    const pending = deferred<{ id: string }>();
    mockCreate.mockReturnValueOnce(pending.promise);
    const root = await render(<NoteBrowser subjectId="subject-1" />);
    await act(async () => { handler(element(root, 'browser-new-note'))(); });
    mockFocused = false;
    await rerender(root, <NoteBrowser subjectId="subject-1" />);
    mockFocused = true;
    await rerender(root, <NoteBrowser subjectId="subject-1" />);
    await act(async () => pending.resolve({ id: 'late' }));
    expect(mockPush).not.toHaveBeenCalled();
    expect(element(root, 'browser-new-note').props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    await unmount(root);
  });

  it('preserves the template picker scope', async () => {
    const root = await render(<NoteBrowser subjectId="subject-1" folderId="folder-1" />);
    await act(async () => { handler(element(root, 'browser-from-template'))(); });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/templates', params: { mode: 'new', subject: 'subject-1', folder: 'folder-1' } });
    await unmount(root);
  });

  it('does not navigate to a note created for a previous browser scope', async () => {
    const pending = deferred<{ id: string }>();
    mockCreate.mockReturnValueOnce(pending.promise);
    const root = await render(<NoteBrowser subjectId="subject-1" folderId="folder-1" />);
    await act(async () => { handler(element(root, 'browser-new-note'))(); });
    await rerender(root, <NoteBrowser subjectId="subject-1" folderId="folder-2" />);
    await act(async () => pending.resolve({ id: 'late' }));
    expect(mockPush).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('distinguishes successful creation from a navigation failure', async () => {
    mockPush.mockImplementationOnce(() => { throw new Error('navigation failed'); });
    const root = await render(<NoteBrowser subjectId="subject-1" />);
    await act(async () => { handler(element(root, 'browser-new-note'))(); });
    expect(contains(root, 'Note created, but could not be opened.')).toBe(true);
    expect(contains(root, 'Could not create note.')).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('does not navigate after unmount', async () => {
    const pending = deferred<{ id: string }>();
    mockCreate.mockReturnValueOnce(pending.promise);
    const root = await render(<NoteBrowser subjectId="subject-1" />);
    await act(async () => { handler(element(root, 'browser-new-note'))(); });
    await unmount(root);
    await act(async () => pending.resolve({ id: 'late' }));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
