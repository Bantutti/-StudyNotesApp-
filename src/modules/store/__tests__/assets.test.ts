import { makeStore } from './helpers';

describe('store.assets (P4b)', () => {
  it('creates a note ink layer and links it in one transaction', async () => {
    const { store, clock } = await makeStore();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight' });
    clock.advance(1000);
    const r = await store.assets.createInkLayer(n.id, { id: 'a_0000000000000001', localPath: 'ink/a_0000000000000001.json', size: 123 });
    expect(r.asset).toMatchObject({ type: 'ink', size: 123, rev: 0, deleted: false, cloudPath: null, owner: null });
    expect(r.noteUpdated).toBeGreaterThan(n.updated); // a synced change: P2b uploads the note's new inkLayerRef
    const note = await store.notes.get(n.id);
    expect(note?.inkLayerRef).toBe('a_0000000000000001');
    expect(note?.updated).toBe(r.noteUpdated);
    // A second layer for the same note is refused (one layer per note).
    await expect(store.assets.createInkLayer(n.id, { id: 'a_0000000000000002', localPath: 'ink/a_0000000000000002.json', size: 1 })).rejects.toThrow();
    expect(await store.assets.get('a_0000000000000002')).toBeNull(); // rolled back
  });

  it('refuses unsafe local paths, oversized files and bad ids', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight' });
    for (const localPath of ['/etc/passwd', '../ink/x.json', 'ink/../../x.json', 'ink/a b.json', 'ink/x', 'INK/x.json']) {
      await expect(store.assets.createInkLayer(n.id, { id: 'a_0000000000000003', localPath, size: 1 })).rejects.toThrow();
    }
    await expect(store.assets.createInkLayer(n.id, { id: 'a_0000000000000003', localPath: 'ink/a_0000000000000003.json', size: 5 * 1024 * 1024 + 1 })).rejects.toThrow();
    await expect(store.assets.createInkLayer(n.id, { id: 'short', localPath: 'ink/short.json', size: 1 })).rejects.toThrow();
    expect(await store.assets.list('ink')).toEqual([]);
  });

  it('updates the size and tombstones without touching cloud fields', async () => {
    const { store, clock } = await makeStore();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight' });
    const { asset } = await store.assets.createInkLayer(n.id, { id: 'a_0000000000000004', localPath: 'ink/a_0000000000000004.json', size: 10 });
    clock.advance(500);
    const u = await store.assets.update(asset.id, { size: 2048 });
    expect(u.size).toBe(2048);
    expect(u.updated).toBeGreaterThan(asset.updated);
    await store.assets.remove(asset.id);
    const gone = await store.assets.get(asset.id);
    expect(gone).toMatchObject({ deleted: true, localPath: null });
    await expect(store.assets.update(asset.id, { size: 1 })).rejects.toThrow();
    expect(await store.assets.list('ink')).toEqual([]);
  });

  it('finds ink orphans only after a deleted note is purged (undo still works)', async () => {
    const { store, clock } = await makeStore();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight' });
    await store.assets.createInkLayer(n.id, { id: 'a_0000000000000005', localPath: 'ink/a_0000000000000005.json', size: 10 });
    expect(await store.assets.inkOrphans()).toEqual([]);
    const token = await store.notes.remove([n.id]);
    expect(await store.assets.inkOrphans()).toEqual([]); // inside the undo window
    expect(await store.undo(token)).toBe(true);
    await store.notes.remove([n.id]);
    clock.advance(9_000);
    await store.purge();
    expect((await store.assets.inkOrphans()).map((a) => a.id)).toEqual(['a_0000000000000005']);
  });

  it('is wiped by Delete all data', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight' });
    await store.assets.createInkLayer(n.id, { id: 'a_0000000000000006', localPath: 'ink/a_0000000000000006.json', size: 10 });
    await store.wipeAll();
    expect(await store.assets.get('a_0000000000000006')).toBeNull();
  });
});
