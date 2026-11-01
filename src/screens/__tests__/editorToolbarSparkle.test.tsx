/**
 * The note screen's keyboard toolbar shows the P3b sparkle slot: EditorActions
 * with placement 'sparkle' render there (live, also when registered after the
 * note opened), the slot shows nothing without one, and pressing a sparkle
 * action runs it through runEditorAction (validate, version, save, show, undo).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import { createLogger, createSeqIdGenerator, memorySink, type DocNode, type NoteDoc } from '@/core';
import { ThemeProvider } from '@/core/ui';
import { beautifyLiteAction, type ActionOutcome } from '@/composition';
import { createEditorActionRegistry, type EditorAction, type EditorActionRegistry, type EditorHost } from '@/modules/editor';
import { openStore, type Store } from '@/modules/store';
import { createPackRegistry, DEFAULT_PACK_ID } from '@/modules/stylepacks';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { EditorToolbar } from '../EditorToolbar';
import { useEditorActionRunner, type ActionAvailabilityContext } from '../editorActionHooks';

// Icon fonts are loaded through expo-asset, which has no registry under Jest.
jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const Glyph = ({ name }: { name: string }) => <Text>{name}</Text>;
  return { __esModule: true, default: Glyph };
});

const line = (text: string, id: string): DocNode => ({ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text }] });
const start: NoteDoc = { type: 'doc', content: [line('Osmosis is when water moves', 'b_osmosisline001')] };
const pack = createPackRegistry().getOrDefault(DEFAULT_PACK_ID);

/** What P3b registers through composition (services.editorActions.register). */
function aiAction(run: EditorAction['run']): EditorAction {
  return { id: 'ai', label: 'AI', icon: 'sparkles-outline', placement: 'sparkle', reason: 'before_ai', run };
}

/** The same wiring as src/app/note/[id].tsx: registry -> toolbar, toolbar press -> runner. */
function Harness(p: {
  registry: EditorActionRegistry;
  store: Store;
  host: EditorHost;
  noteId: string;
  ids: ReturnType<typeof createSeqIdGenerator>;
  onDone(a: EditorAction, o: ActionOutcome | null): void;
  onError(a: EditorAction, e: unknown): void;
  actionContext?: ActionAvailabilityContext | null;
}) {
  const runner = useEditorActionRunner({ store: p.store, ids: p.ids, host: p.host, noteId: p.noteId, onDone: p.onDone, onError: p.onError });
  return (
    <ThemeProvider scheme="light">
      <EditorToolbar
        state={null}
        pack={pack}
        registry={p.registry}
        actionContext={p.actionContext}
        busyAction={runner.busy}
        onCommand={() => {}}
        onAction={(a) => void runner.run(a)}
        onBlockMenu={() => {}}
        onLink={() => {}}
      />
    </ThemeProvider>
  );
}

async function setup(registry = createEditorActionRegistry([beautifyLiteAction]), withContext = false) {
  let t = Date.UTC(2026, 10, 1);
  const ids = createSeqIdGenerator();
  const store = await openStore(nodeSqliteDriver(), { ids, logger: createLogger({ sink: memorySink() }), now: () => (t += 1000) });
  const note = await store.notes.create({ stylePackId: DEFAULT_PACK_ID, document: start });
  let current: NoteDoc = note.document;
  const shown: NoteDoc[] = [];
  const host: EditorHost = {
    getDocument: async () => current,
    getSelection: async () => ['b_osmosisline001'],
    showDocument: (d) => {
      shown.push(d);
      current = d;
    },
  };
  const done: { action: string; outcome: ActionOutcome | null }[] = [];
  const errors: unknown[] = [];
  const root: Root = createRoot();
  await act(async () => {
    root.render(
      <Harness
        registry={registry}
        store={store}
        host={host}
        noteId={note.id}
        ids={ids}
        onDone={(a, o) => done.push({ action: a.id, outcome: o })}
        onError={(_a, e) => errors.push(e)}
        actionContext={withContext ? { noteId: note.id, subjectId: note.subject, title: note.title, stylePackId: note.stylePackId, selection: null } : null}
      />,
    );
  });
  return { registry, store, note, root, shown, done, errors };
}

const slot = (root: Root): TestInstance => {
  const found = root.container.queryAll((n) => n.props.testID === 'editor-sparkle-slot');
  expect(found).toHaveLength(1);
  return found[0]!;
};
const button = (within: TestInstance, label: string) => within.queryAll((n) => n.props.accessibilityLabel === label && n.props.accessibilityRole === 'button');
const childButtons = (within: TestInstance) => within.queryAll((n) => n.props.accessibilityRole === 'button');

/** Presses the nearest Pressable above a host element (what a tap does). */
async function press(el: TestInstance) {
  let f = el.unstable_fiber as { memoizedProps?: { onPress?: () => void }; return: unknown } | null;
  while (f && !f.memoizedProps?.onPress) f = f.return as typeof f;
  expect(f?.memoizedProps?.onPress).toBeDefined();
  await act(async () => {
    f!.memoizedProps!.onPress!();
  });
}

describe('keyboard toolbar: P3b sparkle slot', () => {
  it('the slot is present but shows nothing (and takes no space) when no sparkle action is registered', async () => {
    const { root } = await setup();
    const s = slot(root);
    expect(childButtons(s)).toHaveLength(0);
    expect(s.props.style).toMatchObject({ display: 'none' });
    // Toolbar placement still renders (Beautify Lite), outside the slot.
    expect(button(root.container, beautifyLiteAction.label)).toHaveLength(1);
    expect(button(s, beautifyLiteAction.label)).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it('a sparkle action registered through the registry appears in the slot (also after the note opened) and leaves on unregister', async () => {
    const { root, registry } = await setup();
    let off = () => {};
    await act(async () => {
      off = registry.register(aiAction(async () => null));
    });
    const s = slot(root);
    expect(button(s, 'AI')).toHaveLength(1);
    expect(s.props.style).not.toMatchObject({ display: 'none' });
    await act(async () => off());
    expect(childButtons(slot(root))).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it('pressing the sparkle action runs it through runEditorAction: context, validation, before_ai version, save, show, exact undo', async () => {
    const registry = createEditorActionRegistry([beautifyLiteAction]);
    const run = jest.fn<ReturnType<EditorAction['run']>, Parameters<EditorAction['run']>>(async (ctx) => ({
      doc: { type: 'doc', content: [...ctx.doc.content, line('Summary: water moves to the salty side', 'b_aisummary0001')] },
      message: 'Summary added',
    }));
    registry.register(aiAction(run));
    const { root, store, note, shown, done, errors } = await setup(registry);

    await press(button(slot(root), 'AI')[0]!);

    expect(errors).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toMatchObject({ noteId: note.id, title: note.title, stylePackId: DEFAULT_PACK_ID, doc: start, selection: ['b_osmosisline001'] });
    const saved = (await store.notes.get(note.id))!.document;
    expect(saved.content).toHaveLength(2);
    expect(saved.content[1]).toMatchObject({ attrs: { blockId: 'b_aisummary0001' } });
    expect((await store.versions.list(note.id)).map((v) => v.reason)).toEqual(['before_ai']);
    expect(shown.at(-1)).toEqual(saved);
    expect(done).toHaveLength(1);
    expect(done[0]!.action).toBe('ai');
    expect(done[0]!.outcome?.message).toBe('Summary added');

    await act(async () => done[0]!.outcome!.undo());
    expect((await store.notes.get(note.id))!.document).toEqual(start);
    await act(async () => root.unmount());
  });

  it('an invalid sparkle result is rejected by runEditorAction and nothing is saved', async () => {
    const registry = createEditorActionRegistry();
    registry.register(aiAction(async () => ({ doc: { type: 'doc', content: [{ type: 'script' }] } as unknown as NoteDoc, message: 'x' })));
    const { root, store, note, errors, done } = await setup(registry);
    await press(button(slot(root), 'AI')[0]!);
    expect(done).toHaveLength(0);
    expect(errors[0]).toMatchObject({ code: 'validation_failed' });
    expect((await store.notes.get(note.id))!.document).toEqual(start);
    expect(await store.versions.list(note.id)).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it('hides a sparkle action whose isAvailable() says no for this note, and keeps one that throws out of the way', async () => {
    const registry = createEditorActionRegistry();
    const seen: string[] = [];
    registry.register({ ...aiAction(async () => null), isAvailable: (ctx) => (seen.push(ctx.stylePackId), false) });
    registry.register({ ...aiAction(async () => null), id: 'ai-broken', label: 'Broken', isAvailable: () => { throw new Error('x'); } });
    registry.register({ ...aiAction(async () => null), id: 'ai-quiz', label: 'Quiz', isAvailable: () => true });
    const { root } = await setup(registry, true);
    const s = slot(root);
    expect(button(s, 'AI')).toHaveLength(0);
    expect(button(s, 'Broken')).toHaveLength(0);
    expect(button(s, 'Quiz')).toHaveLength(1);
    expect(seen[0]).toBe(DEFAULT_PACK_ID);
    await act(async () => root.unmount());
  });

  it('the note screen uses this same wiring (registry into the toolbar, presses through the runner)', () => {
    const src = readFileSync(join(__dirname, '../../app/note/[id].tsx'), 'utf8');
    expect(src).toContain('useEditorActionRunner({');
    expect(src).toContain('registry={editorActions}');
    expect(src).toContain('actionContext={actionContext}');
    expect(src).toContain('onAction={(a) => void runner.run(a)}');
  });
});
