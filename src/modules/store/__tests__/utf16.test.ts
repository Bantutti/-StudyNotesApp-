/**
 * Synced text is measured in UTF-16 units, exactly like the Firestore rules
 * and P2a's utf16String (MERGE_NOTES §6.2). An emoji counts 2. Anything the
 * phone accepts, the cloud schema accepts too, at every boundary.
 */
import * as p2a from '../../../../firebase/src/schemas';
import { makeStore } from './helpers';

const E = '😀'; // 2 UTF-16 units, 1 code point

describe('UTF-16 limits on synced text fields', () => {
  it('subject and folder names: 80 units', async () => {
    const { store } = await makeStore();
    const s = await store.subjects.create({ name: E.repeat(40), color: '111111' });
    await expect(store.subjects.create({ name: E.repeat(41), color: '111111' })).rejects.toMatchObject({ code: 'validation_failed' });
    await store.folders.create({ subject: s.id, name: E.repeat(40) });
    await expect(store.folders.create({ subject: s.id, name: E.repeat(41) })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('note titles: 200 units; tags: 40 units', async () => {
    const { store } = await makeStore();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight' });
    await store.notes.save(n.id, { title: E.repeat(100), tags: [E.repeat(20)] });
    await expect(store.notes.save(n.id, { title: E.repeat(101) })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(store.notes.save(n.id, { tags: [E.repeat(21)] })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('agrees with P2a at the boundary (accepted locally => accepted by the cloud schema)', () => {
    const cloud = p2a.utf16String(1, p2a.TEXT.tag);
    expect(cloud.safeParse(E.repeat(20)).success).toBe(true);
    expect(cloud.safeParse(E.repeat(21)).success).toBe(false);
  });

  it('tags read back from storage are filtered with UTF-16 counting', async () => {
    const { store, driver } = await makeStore();
    const n = await store.notes.create({ stylePackId: 'pastel-highlight' });
    driver.raw.prepare('UPDATE notes SET tags = ? WHERE id = ?').run(JSON.stringify([E.repeat(20), E.repeat(21)]), n.id);
    expect((await store.notes.get(n.id))?.tags).toEqual([E.repeat(20)]);
  });
});
