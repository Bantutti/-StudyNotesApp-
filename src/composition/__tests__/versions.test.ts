import { createLogger, createSeqIdGenerator, listBlockIds, memorySink, SAMPLE_NOTE, type NoteDoc } from '@/core';
import { openStore, VERSIONS_KEPT, VERSION_REASONS } from '@/modules/store';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { beautifyLiteAction, runEditorAction } from '../editorActions';
import { checkpointOnLeave, checkpointWhileEditing, EDIT_CHECKPOINT_MS, versionLabel } from '../versions';

async function setup() {
  let t = Date.UTC(2026, 10, 1);
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const ids = createSeqIdGenerator();
  const store = await openStore(nodeSqliteDriver(), { ids, logger: createLogger({ sink: memorySink() }), now: clock.now });
  return { store, ids, clock };
}
const para = (text: string): NoteDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('version rules', () => {
  it('saves an edit checkpoint at most every 10 minutes', async () => {
    const { store, clock } = await setup();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: para('v1') });
    expect(await checkpointWhileEditing(store, n.id, clock.now())).toBe(true); // first one
    await store.notes.save(n.id, { document: para('v2') });
    clock.advance(EDIT_CHECKPOINT_MS - 1000);
    expect(await checkpointWhileEditing(store, n.id, clock.now())).toBe(false);
    clock.advance(1000);
    expect(await checkpointWhileEditing(store, n.id, clock.now())).toBe(true);
    expect((await store.versions.list(n.id)).map((v) => v.reason)).toEqual(['edit', 'edit']);
  });

  it('saves a leave version only when the note changed, without duplicates', async () => {
    const { store } = await setup();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: para('v1') });
    expect(await checkpointOnLeave(store, n.id, false)).toBe(false);
    expect(await checkpointOnLeave(store, n.id, true)).toBe(true);
    expect(await checkpointOnLeave(store, n.id, true)).toBe(false); // same content
  });

  it('labels every reason', () => {
    for (const r of VERSION_REASONS) expect(versionLabel(r)).toMatch(/\w/);
    expect(versionLabel('before_beautify')).toBe('Before Beautify');
  });
});

describe('block ids survive restore and pack switching', () => {
  it('pack switch keeps ids; restoring the version brings back the pack and the exact ids', async () => {
    const { store } = await setup();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: SAMPLE_NOTE });
    await store.notes.save(n.id, { stylePackId: 'clear-read' }, { before: 'before_pack' });
    const switched = await store.notes.get(n.id);
    expect(listBlockIds(switched!.document)).toEqual(listBlockIds(SAMPLE_NOTE));
    const [v] = await store.versions.list(n.id);
    await store.versions.restore(n.id, v!.id);
    const restored = await store.notes.get(n.id);
    expect(restored).toMatchObject({ stylePackId: 'pastel-highlight' });
    expect(restored!.document).toEqual(SAMPLE_NOTE);
  });

  it('restoring the version from before Beautify gives back the original ids exactly', async () => {
    const { store, ids } = await setup();
    const messy: NoteDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'b_messyline00001' }, content: [{ type: 'text', text: 'Osmosis :: water moves' }] },
        { type: 'paragraph', attrs: { blockId: 'b_messyline00002' }, content: [{ type: 'text', text: '- passive' }] },
      ],
    };
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: messy });
    let current = n.document;
    const host = { getDocument: async () => current, getSelection: async () => null, showDocument: (d: NoteDoc) => (current = d) };
    await runEditorAction(beautifyLiteAction, { store, ids, host }, n.id);
    const [v] = await store.versions.list(n.id);
    expect(v?.reason).toBe('before_beautify');
    await store.versions.restore(n.id, v!.id);
    expect((await store.notes.get(n.id))!.document).toEqual(messy);
  });

  it(`history stays capped at ${VERSIONS_KEPT} through many checkpoints`, async () => {
    const { store, clock } = await setup();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: para('start') });
    for (let i = 0; i < 30; i++) {
      await store.notes.save(n.id, { document: para(`edit ${i}`) });
      clock.advance(EDIT_CHECKPOINT_MS);
      await checkpointWhileEditing(store, n.id, clock.now());
    }
    expect(await store.versions.list(n.id)).toHaveLength(VERSIONS_KEPT);
  });
});
