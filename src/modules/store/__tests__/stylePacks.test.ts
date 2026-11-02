/**
 * P5 M5: custom style packs in the local store (Q7 = A), and their cloud contract.
 */
import { createPackRegistry } from '@/modules/stylepacks';

import * as p2a from '../../../../firebase/src/schemas';
import { ERASED_DEFINITION, PACK_DEFINITION_MAX_CHARS } from '../stylePacks';

import { makeStore } from './helpers';

const ID = 'ref-abcdefghijklmnopqrst';
const pack = { ...createPackRegistry().get('pastel-highlight')!, id: ID, name: 'My look', meta: { ...createPackRegistry().get('pastel-highlight')!.meta, tier: 'extra' as const } };

/** Same row -> cloud mapping as cloudContract.test.ts (booleans 0/1 -> bool, ms -> Timestamp). */
const ts = (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000, toMillis: () => ms });
function toCloud(row: Record<string, unknown>, uid: string) {
  return {
    ...row,
    owner: uid,
    created: ts(row.created as number),
    updated: ts(row.updated as number),
    rev: Math.max(1, row.rev as number),
    deleted: row.deleted === 1 || row.deleted === true,
    createdFromReference: row.createdFromReference === 1 || row.createdFromReference === true,
  };
}

describe('store.stylePacks', () => {
  it('saves, lists, reads and replaces a custom pack (version + 1)', async () => {
    const { store, clock } = await makeStore();
    const a = await store.stylePacks.save({ id: ID, definition: pack, createdFromReference: true });
    expect(a).toMatchObject({ id: ID, version: 1, createdFromReference: true, deleted: false, rev: 0, owner: null });
    expect(JSON.parse(a.definition)).toEqual(pack);
    clock.advance(1000);
    const b = await store.stylePacks.save({ id: ID, definition: { ...pack, name: 'Renamed' }, createdFromReference: true });
    expect(b.version).toBe(2);
    expect(b.updated).toBeGreaterThan(a.updated);
    expect((await store.stylePacks.list()).map((p) => JSON.parse(p.definition).name)).toEqual(['Renamed']);
  });

  it('refuses non-custom ids, non-objects and definitions over the cloud cap', async () => {
    const { store } = await makeStore();
    await expect(store.stylePacks.save({ id: 'pastel-highlight', definition: pack, createdFromReference: true })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(store.stylePacks.save({ id: "ref-'; DROP TABLE notes;--", definition: pack, createdFromReference: true })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(store.stylePacks.save({ id: ID, definition: [1, 2], createdFromReference: true })).rejects.toMatchObject({ code: 'validation_failed' });
    const huge = { ...pack, name: 'x'.repeat(PACK_DEFINITION_MAX_CHARS) };
    await expect(store.stylePacks.save({ id: ID, definition: huge, createdFromReference: true })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('delete leaves a tombstone with the definition erased, and moves notes and subjects to the fallback pack', async () => {
    const { store } = await makeStore();
    await store.stylePacks.save({ id: ID, definition: pack, createdFromReference: true });
    const s = await store.subjects.create({ name: 'Bio', color: '#4F7CF7', defaultPack: ID });
    const n = await store.notes.create({ subject: s.id, title: 'Cells', stylePackId: ID });
    expect(await store.stylePacks.remove(ID, 'pastel-highlight')).toBe(1);
    const row = await store.stylePacks.get(ID);
    expect(row).toMatchObject({ deleted: true, definition: ERASED_DEFINITION });
    expect(await store.stylePacks.list()).toEqual([]);
    expect((await store.notes.get(n.id))?.stylePackId).toBe('pastel-highlight');
    expect((await store.subjects.get(s.id))?.defaultPack).toBeNull();
    expect(await store.stylePacks.remove(ID, 'pastel-highlight')).toBe(0); // idempotent
    await expect(store.stylePacks.save({ id: ID, definition: pack, createdFromReference: true })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('live and deleted rows map 1:1 onto P2a stylePackSchema (cloud contract)', async () => {
    const { store, driver } = await makeStore();
    await store.stylePacks.save({ id: ID, definition: pack, createdFromReference: true });
    const read = (): Record<string, unknown> => driver.raw.prepare('SELECT * FROM stylePacks WHERE id = ?').get(ID) as Record<string, unknown>;
    expect(p2a.stylePackSchema.safeParse(toCloud(read(), 'uid-1')).success).toBe(true);
    await store.stylePacks.remove(ID, 'pastel-highlight');
    expect(p2a.stylePackSchema.safeParse(toCloud(read(), 'uid-1')).success).toBe(true);
  });
});
