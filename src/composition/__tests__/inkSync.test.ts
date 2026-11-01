/**
 * P4b M8: the ink side of sync, with P2b's pipeline replaced by fakes.
 * Two devices (two stores, two file systems) share a fake "cloud" holding
 * the published file text, which is what P2b's Storage upload/download moves.
 */
import { createLogger, createSeqIdGenerator, memorySink, type NoteDoc } from '@/core';
import {
  applyOp,
  createInkService,
  inkAssetMerger,
  parseInkJson,
  registerInkMerger,
  serializeInk,
  type AssetMergerRegistry,
  type InkFilesPort,
  type InkLayer,
  type InkStroke,
} from '@/modules/ink';
import { openStore, type Store } from '@/modules/store';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { inkStorePort } from '../ink';

const B1 = 'b_AAAAAAAAAA01';
const doc: NoteDoc = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: B1 }, content: [{ type: 'text', text: 'x' }] }] };

function memFiles(): InkFilesPort & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (p) => files.get(p) ?? null,
    writeAtomic: async (p, t) => {
      files.set(p, t);
    },
    remove: async (p) => {
      files.delete(p);
    },
    list: async () => [],
  };
}

let sn = 0;
const stroke = (): InkStroke => ({ id: `s_Y${String(++sn).padStart(15, '0')}`, b: B1, tool: 'pen', c: 'p0', w: 30, o: [10, 10], d: [5, 5], t: 1_760_000_000_000 + sn });

async function device(name: string, cloud: Map<string, string>, noteId?: string) {
  let t = Date.UTC(2026, 10, 1);
  const now = () => (t += 7);
  const ids = createSeqIdGenerator();
  const logger = createLogger({ sink: memorySink(), minLevel: 'debug' });
  const store = await openStore(nodeSqliteDriver(), { ids: { newId: (p) => ids.newId(`${p}${name}`) }, logger, now });
  const files = memFiles();
  const svc = createInkService({ files, store: inkStorePort(store), ids, logger, now, download: async (assetId) => cloud.get(assetId) ?? null });
  const add = (layer: InkLayer, ...s: InkStroke[]) => {
    const r = applyOp(layer, { remove: [], add: s }, { newStrokeId: () => ids.newId('s'), now });
    if (!r.ok) throw new Error('full');
    return r.layer;
  };
  return { store, files, svc, add, noteId };
}

/** Simulates P2b's pull: the asset row and note link arrive on the second device (file not yet downloaded). */
async function pullRows(from: Store, to: Store, noteId: string) {
  const n = await from.notes.get(noteId);
  const a = await from.assets.get(n!.inkLayerRef!);
  // Device B already has the note (synced earlier); it gets the asset row, without a local file.
  await to.assets.createInkLayer(noteId, { id: a!.id, localPath: `ink/${a!.id}.json`, size: a!.size });
  await to.assets.setLocalPath(a!.id, null);
  return a!.id;
}

describe('ink merger (registered with P2b for type ink)', () => {
  const layer = (strokes: InkStroke[], gone: InkLayer['gone'] = []): InkLayer => ({ kind: 'notedpo-ink', v: 1, note: 'n_0000000000000001', unit: 1000, strokes, gone });

  it('merges as a union with tombstones', () => {
    const a = stroke();
    const b = stroke();
    const c = stroke();
    const merged = inkAssetMerger(serializeInk(layer([a, b])), serializeInk(layer([c], [{ id: b.id, t: 1 }])));
    expect(merged).not.toBeNull();
    const r = parseInkJson(merged as string);
    expect(r.ok && r.value.strokes.map((s) => s.id).sort()).toEqual([a.id, c.id].sort());
  });

  it('refuses damaged, tampered or foreign files (null = keep local, nothing lost)', () => {
    const good = serializeInk(layer([stroke()]));
    expect(inkAssetMerger(good, '{"kind":"notedpo-ink"')).toBeNull();
    expect(inkAssetMerger('not json', good)).toBeNull();
    expect(inkAssetMerger(good, serializeInk({ ...layer([stroke()]), note: 'n_0000000000000002' }))).toBeNull();
    expect(inkAssetMerger(good, good.replace('"c":"p0"', '"c":"javascript:x"'))).toBeNull();
  });

  it('registers itself with P2b\'s registry under type ink', () => {
    const got: { type: string; fn: (a: string, b: string) => string | null }[] = [];
    const registry: AssetMergerRegistry = { registerAssetMerger: (type, fn) => got.push({ type, fn }) };
    registerInkMerger(registry);
    expect(got).toHaveLength(1);
    expect(got[0]?.type).toBe('ink');
    expect(got[0]?.fn).toBe(inkAssetMerger);
  });
});

describe('two devices (P2b replaced by a fake cloud)', () => {
  it('device B downloads the drawing on open; offline edits on both sides merge without losing strokes', async () => {
    const cloud = new Map<string, string>();
    const A = await device('A', cloud);
    const noteA = await A.store.notes.create({ stylePackId: 'pastel-highlight', document: doc });

    // A draws and publishes; P2b uploads the file (fake: copy to the cloud).
    const sA = await A.svc.open(noteA.id);
    const s1 = stroke();
    sA.replace(A.add(sA.layer, s1));
    await sA.publish({ liveBlockIds: [B1] });
    const assetA = (await A.store.notes.get(noteA.id))!.inkLayerRef!;
    cloud.set(assetA, A.files.files.get(`ink/${assetA}.json`)!);

    // Device B: P2b synced the note row (same id) and the asset row, but not the file yet.
    // The same id prefix makes B's first note get A's note id, as sync would.
    const B2 = await device('A', cloud);
    const noteB2 = await B2.store.notes.create({ stylePackId: 'pastel-highlight', document: doc });
    expect(noteB2.id).toBe(noteA.id);
    const assetId = await pullRows(A.store, B2.store, noteA.id);
    const sB = await B2.svc.open(noteA.id);
    expect(sB.source).toBe('published');
    expect(sB.layer.strokes.map((s) => s.id)).toEqual([s1.id]);
    const stored = await B2.store.assets.get(assetId);
    expect(stored?.localPath).toBe(`ink/${assetId}.json`);
    expect(B2.files.files.has(`ink/${assetId}.json`)).toBe(true);

    // Offline: A erases nothing and adds s2; B adds s3. P2b detects the stale upload and calls the merger.
    const s2 = stroke();
    const s3 = stroke();
    const textA = serializeInk(A.add(sA.layer, s2));
    const textB = serializeInk(B2.add(sB.layer, s3));
    const merged = inkAssetMerger(textB, textA);
    const r = parseInkJson(merged as string, { expectedNote: noteA.id });
    expect(r.ok && r.value.strokes.map((s) => s.id).sort()).toEqual([s1.id, s2.id, s3.id].sort());
  });

  it('a tampered cloud copy is never stored; the note opens empty and reports damage', async () => {
    const cloud = new Map<string, string>();
    const A = await device('A', cloud);
    const note = await A.store.notes.create({ stylePackId: 'pastel-highlight', document: doc });
    const sA = await A.svc.open(note.id);
    sA.replace(A.add(sA.layer, stroke()));
    await sA.publish({ liveBlockIds: [B1] });
    const assetId = (await A.store.notes.get(note.id))!.inkLayerRef!;
    cloud.set(assetId, '{"kind":"notedpo-ink","v":1,"note":"x","unit":1000,"strokes":[{"id":"<script>"}],"gone":[]}');
    const B = await device('A', cloud);
    await B.store.notes.create({ stylePackId: 'pastel-highlight', document: doc });
    await pullRows(A.store, B.store, note.id);
    const sB = await B.svc.open(note.id);
    expect(sB.damaged).toBe(true);
    expect(sB.layer.strokes).toHaveLength(0);
    expect(B.files.files.size).toBe(0);
  });

  it('recording a download location is local only: the asset row is not marked changed', async () => {
    const cloud = new Map<string, string>();
    const A = await device('A', cloud);
    const note = await A.store.notes.create({ stylePackId: 'pastel-highlight', document: doc });
    const { asset } = await A.store.assets.createInkLayer(note.id, { id: 'a_0000000000000099', localPath: 'ink/a_0000000000000099.json', size: 10 });
    await A.store.assets.setLocalPath(asset.id, 'ink/other_name_123456.json');
    const after = await A.store.assets.get(asset.id);
    expect(after?.updated).toBe(asset.updated);
    expect(after?.localPath).toBe('ink/other_name_123456.json');
    await expect(A.store.assets.setLocalPath(asset.id, '../etc/passwd')).rejects.toThrow();
  });
});
