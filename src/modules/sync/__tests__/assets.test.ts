/**
 * The asset pass: doc first, then file; on-demand downloads; last push wins
 * without a merger; P4b's merge hook (registerAssetMerger) with a fake
 * merger, both when the upload is stale and when a newer version is pulled
 * while the local file has unsynced changes.
 */
import { UNDO_WINDOW_MS } from '@/modules/store';

import { createAssetMergerRegistry, defaultAssetMergers, registerAssetMerger, syncAssetFiles, type AssetMerger } from '../assets';
import { setup, UID, type Device } from './harness';

const enc = (strokes: string[]) => new TextEncoder().encode(JSON.stringify(strokes));
const dec = (b: Uint8Array | undefined): string[] => (b ? (JSON.parse(new TextDecoder().decode(b)) as string[]) : []);

/** Fake ink merger: union of stroke ids, sorted (deterministic, order-independent). */
const unionMerger: AssetMerger = (l, r) => enc([...new Set([...dec(l), ...dec(r)])].sort());

const INK = 'a_ink0000000000001';

async function addInk(d: Device, strokes: string[], id = INK) {
  const path = `file:///${d.name}/${id}.json`;
  d.files.set(path, enc(strokes));
  const t = Date.UTC(2026, 10, 1, 8, 0, 0);
  d.raw.prepare(`INSERT INTO assets (id, created, updated, type, cloudPath, size, localPath) VALUES (?, ?, ?, 'ink', NULL, 0, ?)`).run(id, t, t, path);
  return path;
}

async function editInk(d: Device, strokes: string[], id = INK) {
  const row = d.raw.prepare('SELECT localPath FROM assets WHERE id = ?').get(id) as { localPath: string };
  d.files.set(row.localPath, enc(strokes));
  // What P4b's store.assets does when the note is left: update the size (queued).
  d.raw.prepare('UPDATE assets SET size = ?, updated = updated + 1 WHERE id = ?').run(enc(strokes).length, id);
}

describe('asset files', () => {
  it('uploads the doc (exact size and path) and then the file; another device downloads on demand', async () => {
    const { A, B, cloud } = await setup();
    await A.enable();
    await B.enable();
    await addInk(A, ['s1', 's2']);
    const r = await A.sync();
    expect(r.assets).toMatchObject({ uploaded: 1, failed: 0 });
    const path = `users/${UID}/ink/${INK}.json`;
    expect(cloud.peek('assets', INK)).toMatchObject({ cloudPath: path, size: enc(['s1', 's2']).length, rev: 1, type: 'ink' });
    expect(dec(cloud.files().get(path))).toEqual(['s1', 's2']);
    await B.sync();
    expect(B.files.size).toBe(0); // nothing downloaded in bulk
    const local = await B.engine.ensureLocalFile(INK);
    expect(dec(B.files.get(local))).toEqual(['s1', 's2']);
    // Syncing again uploads nothing.
    expect((await A.sync()).assets).toMatchObject({ uploaded: 0, downloaded: 0 });
  });

  it('a newer version from the other device replaces an unchanged local file', async () => {
    const { A, B } = await setup();
    await A.enable();
    await B.enable();
    await addInk(A, ['s1']);
    await A.sync();
    await B.sync();
    await B.engine.ensureLocalFile(INK);
    await editInk(A, ['s1', 's2']);
    await A.sync();
    const r = await B.sync();
    expect(r.assets?.downloaded).toBe(1);
    const p = B.raw.prepare('SELECT localPath FROM assets').get() as { localPath: string };
    expect(dec(B.files.get(p.localPath))).toEqual(['s1', 's2']);
  });

  it('without a merger, both changed = last push wins (ours on top)', async () => {
    const { A, B, cloud } = await setup();
    await A.enable();
    await B.enable();
    await addInk(A, ['s1']);
    await A.sync();
    await B.sync();
    await B.engine.ensureLocalFile(INK);
    await editInk(A, ['s1', 'a']);
    await editInk(B, ['s1', 'bb']);
    await A.sync();
    await B.sync();
    await A.sync();
    expect(dec(cloud.files().get(`users/${UID}/ink/${INK}.json`))).toEqual(['s1', 'bb']);
    const pa = A.raw.prepare('SELECT localPath FROM assets').get() as { localPath: string };
    expect(dec(A.files.get(pa.localPath))).toEqual(['s1', 'bb']);
    expect(await B.store.sync.countConflicts()).toBe(0);
  });

  it.each([
    ['pull finds a newer version while the local file has unsynced changes', 'pull'],
    ['the upload of the local change is stale', 'stale'],
  ])('with a merger: %s -> merged on both devices', async (_label, mode) => {
    const { A, B, cloud } = await setup();
    for (const d of [A, B]) d.mergers.register('ink', unionMerger);
    await A.enable();
    await B.enable();
    await addInk(A, ['s1']);
    await A.sync();
    await B.sync();
    await B.engine.ensureLocalFile(INK);
    await editInk(A, ['s1', 'a1']);
    await editInk(B, ['s1', 'b1']);
    await A.sync();
    if (mode === 'stale') {
      // B runs its asset pass WITHOUT pulling first: its doc upload (based on
      // rev 1) is refused because the cloud is at rev 2.
      const r = await syncAssetFiles(B.ctx, B.assetDeps);
      expect(r).toMatchObject({ merged: 1, uploaded: 1, failed: 0 });
    } else {
      const r = await B.sync();
      expect(r.assets?.merged).toBe(1);
    }
    await B.sync();
    await A.sync();
    const merged = ['a1', 'b1', 's1'];
    expect(dec(cloud.files().get(`users/${UID}/ink/${INK}.json`))).toEqual(merged);
    for (const d of [A, B]) {
      const p = d.raw.prepare('SELECT localPath, size FROM assets').get() as { localPath: string; size: number };
      expect(dec(d.files.get(p.localPath))).toEqual(merged);
      expect(p.size).toBe(enc(merged).length);
    }
    expect(cloud.peek('assets', INK)).toMatchObject({ size: enc(merged).length });
  });

  it('never uploads a file before its doc matches (Storage rules mirror)', async () => {
    const { A, cloud } = await setup(1);
    await A.enable();
    await A.sync();
    const blobs = cloud.blobs(() => A.auth);
    await expect(blobs.upload(`users/${UID}/ink/${INK}.json`, enc(['x']), 'application/json')).rejects.toMatchObject({ code: 'permission-denied' });
    await addInk(A, ['s1']);
    await A.sync();
    await expect(blobs.upload(`users/${UID}/ink/${INK}.json`, enc(['s1', 'longer']), 'application/json')).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(blobs.upload(`users/someone_else/ink/${INK}.json`, enc(['s1']), 'application/json')).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('deleting an asset removes its Storage file and syncs an erased tombstone', async () => {
    const { A, cloud, clock } = await setup(1);
    await A.enable();
    await addInk(A, ['s1']);
    await A.sync();
    A.raw.prepare(`UPDATE assets SET deleted = 1, updated = ? WHERE id = ?`).run(clock.now(), INK);
    clock.advance(UNDO_WINDOW_MS + 1);
    const r = await A.sync();
    expect(r.assets?.removed).toBe(1);
    expect(cloud.files().size).toBe(0);
    expect(cloud.peek('assets', INK)).toMatchObject({ deleted: true, cloudPath: null, size: 0 });
  });

  it('refuses files of the wrong type or size', async () => {
    const { A, cloud } = await setup(1);
    await A.enable();
    A.files.set('file:///A/x.exe', enc(['x']));
    A.raw.prepare(`INSERT INTO assets (id, created, updated, type, size, localPath) VALUES ('a_bad000000000001', 1, 1, 'ink', 0, 'file:///A/x.exe')`).run();
    await A.sync();
    expect(cloud.files().size).toBe(0);
    expect((await A.store.sync.listQuarantine()).map((q) => q.reason)).toContain('file_type');
  });
});

describe('merger registry', () => {
  it('registers, replaces and unregisters', () => {
    const reg = createAssetMergerRegistry();
    const off = reg.register('ink', unionMerger);
    expect(reg.get('ink')).toBe(unionMerger);
    off();
    expect(reg.get('ink')).toBeUndefined();
    const off2 = registerAssetMerger('ink', unionMerger);
    expect(defaultAssetMergers().get('ink')).toBe(unionMerger);
    off2();
    expect(defaultAssetMergers().get('ink')).toBeUndefined();
  });
});
