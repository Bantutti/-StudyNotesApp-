import { createLogger, createSeqIdGenerator, listBlockIds, memorySink, type DocNode, type NoteDoc } from '@/core';
import { createEditorActionRegistry, type EditorAction, type EditorHost } from '@/modules/editor';
import { openStore } from '@/modules/store';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { beautifyLiteAction, runEditorAction } from '../editorActions';

const line = (text: string, id: string): DocNode => ({ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text }] });
const messy: NoteDoc = { type: 'doc', content: [line('Osmosis :: water moves across a membrane', 'b_osmosisline001'), line('- passive', 'b_passiveline001')] };

async function setup(doc: NoteDoc = messy) {
  let t = Date.UTC(2026, 10, 1);
  const ids = createSeqIdGenerator();
  const store = await openStore(nodeSqliteDriver(), { ids, logger: createLogger({ sink: memorySink() }), now: () => (t += 1000) });
  const note = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc });
  let shown: NoteDoc | null = null;
  let current: NoteDoc = note.document;
  const host: EditorHost = {
    getDocument: async () => current,
    getSelection: async () => null,
    showDocument: (d) => {
      shown = d;
      current = d;
    },
  };
  return { store, ids, note, host, shown: () => shown, setCurrent: (d: NoteDoc) => (current = d) };
}

describe('editor action hook', () => {
  it('Beautify Lite saves a version, keeps ids, and undo restores the exact document', async () => {
    const { store, ids, note, host, shown } = await setup();
    const outcome = await runEditorAction(beautifyLiteAction, { store, ids, host }, note.id);
    expect(outcome?.message).toBe('Beautified: 1 definition, 1 list');
    const after = await store.notes.get(note.id);
    expect(after!.document.content[0]).toMatchObject({ type: 'definition', attrs: { blockId: 'b_osmosisline001' } });
    expect(listBlockIds(after!.document)).toContain('b_passiveline001');
    expect(shown()).toEqual(after!.document);
    expect((await store.versions.list(note.id)).map((v) => v.reason)).toEqual(['before_beautify']);
    await outcome!.undo();
    expect((await store.notes.get(note.id))!.document).toEqual(note.document);
    expect(shown()).toEqual(note.document);
  });

  it('stores unsaved editor changes before the version', async () => {
    const { store, ids, note, host, setCurrent } = await setup();
    const edited: NoteDoc = { type: 'doc', content: [...messy.content, line('Diffusion :: particles spread', 'b_diffusionline1')] };
    setCurrent(edited);
    await runEditorAction(beautifyLiteAction, { store, ids, host }, note.id);
    const [v] = await store.versions.list(note.id);
    expect((await store.versions.get(v!.id))!.document).toEqual(edited);
  });

  it('returns null and saves nothing when there is nothing to change', async () => {
    const plain: NoteDoc = { type: 'doc', content: [line('Just a sentence.', 'b_plainline0001')] };
    const { store, ids, note, host } = await setup(plain);
    expect(await runEditorAction(beautifyLiteAction, { store, ids, host }, note.id)).toBeNull();
    expect(await store.versions.list(note.id)).toHaveLength(0);
  });

  it('rejects invalid output from an action (e.g. a bad AI result) without saving', async () => {
    const { store, ids, note, host } = await setup();
    const evil: EditorAction = {
      id: 'evil',
      label: 'Evil',
      icon: 'bug',
      placement: 'sparkle',
      reason: 'before_ai',
      run: async () => ({ doc: { type: 'doc', content: [{ type: 'script' }] } as unknown as NoteDoc, message: 'x' }),
    };
    await expect(runEditorAction(evil, { store, ids, host }, note.id)).rejects.toMatchObject({ code: 'validation_failed' });
    expect((await store.notes.get(note.id))!.document).toEqual(note.document);
    expect(await store.versions.list(note.id)).toHaveLength(0);
  });

  it('registry: lists by placement, rejects duplicates and bad ids, unregisters', () => {
    const reg = createEditorActionRegistry([beautifyLiteAction]);
    const ai: EditorAction = { ...beautifyLiteAction, id: 'ai-summarize', placement: 'sparkle', reason: 'before_ai' };
    const off = reg.register(ai);
    expect(reg.list('toolbar').map((a) => a.id)).toEqual(['beautify-lite']);
    expect(reg.list('sparkle').map((a) => a.id)).toEqual(['ai-summarize']);
    expect(() => reg.register(ai)).toThrow('duplicate_action');
    expect(() => reg.register({ ...ai, id: 'Bad Id' })).toThrow('bad_action_id');
    off();
    expect(reg.get('ai-summarize')).toBeUndefined();
  });
});
