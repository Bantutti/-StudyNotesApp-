/**
 * Two simulated devices on the REAL Firebase JS SDK and the REAL rules
 * (emulators, project demo-studynotes). Proves the fake cloud's
 * assumptions: server timestamps with microseconds, rev + 1, batch
 * rejection, owner-scoped queries, Storage's asset-doc cross-check.
 */
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { collection, doc, getDocsFromServer, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

import { EMPTY_DOC_JSON, makeLongSample, SAMPLE_NOTE } from '@/core';
import { UNDO_WINDOW_MS } from '@/modules/store';

import { cloudFor, createVerifiedUser, resetEmulators, signIn } from '../../../../test/e2e/emulator';
import { makeE2EDevice, type E2EDevice } from './device';

const PACK = 'pastel-highlight';
const enc = (s: string[]) => new TextEncoder().encode(JSON.stringify(s));
const dec = (b: Uint8Array | undefined): string[] => (b ? (JSON.parse(new TextDecoder().decode(b)) as string[]) : []);

let devices: E2EDevice[] = [];
let email = '';

async function two(): Promise<{ A: E2EDevice; B: E2EDevice; uid: string }> {
  const A = await makeE2EDevice('A');
  const B = await makeE2EDevice('B');
  devices.push(A, B);
  email = `rey.${Date.now()}@example.com`;
  const uid = await createVerifiedUser(A.cloud.auth, email);
  await signIn(B.cloud.auth, email);
  await A.start(uid);
  await B.start(uid);
  return { A, B, uid };
}

beforeEach(async () => {
  await resetEmulators();
});

afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});

describe('two devices on the emulator', () => {
  it('guest notes upload, the other device gets them, and later edits sync (rev + 1, microsecond timestamps)', async () => {
    const { A, B } = await two();
    const s = await A.store.subjects.create({ name: 'Biology 😀', color: '4F7CF7' });
    const n = await A.store.notes.create({ stylePackId: PACK, subject: s.id, title: 'Osmosis', document: SAMPLE_NOTE, tags: ['exam'] });
    expect((await A.engine().syncNow()).status).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect((await B.engine().syncNow()).status.phase).toBe('idle');
    expect(await B.store.notes.get(n.id)).toMatchObject({ title: 'Osmosis', rev: 1, tags: ['exam'] });
    expect((await B.store.search('osmosis')).length).toBe(1);
    // Edits after a pull: `created` (microseconds on the server) is never resent.
    await B.store.notes.save(n.id, { title: 'Osmosis v2' });
    expect((await B.engine().syncNow()).status).toMatchObject({ phase: 'idle', pending: 0, conflicts: 0 });
    await A.engine().syncNow();
    expect(await A.store.notes.get(n.id)).toMatchObject({ title: 'Osmosis v2', rev: 2 });
    await A.store.subjects.update(s.id, { name: 'Bio' });
    await A.engine().syncNow();
    await B.engine().syncNow();
    expect((await B.store.subjects.get(s.id))?.name).toBe('Bio');
  });

  it('block ids are fixed before upload (the cloud requires them)', async () => {
    const { A, B } = await two();
    const n = await A.store.notes.create({ stylePackId: PACK });
    A.raw.prepare('UPDATE notes SET document = ? WHERE id = ?').run(JSON.stringify(makeLongSample(2)), n.id);
    expect((await A.engine().syncNow()).status).toMatchObject({ quarantined: 0, pending: 0 });
    await B.engine().syncNow();
    expect(JSON.stringify((await B.store.notes.get(n.id))?.document)).toBe(JSON.stringify((await A.store.notes.get(n.id))?.document));
  });

  it('edits on both devices: the real rules reject the stale write and it becomes a conflict; Keep both works', async () => {
    const { A, B } = await two();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'Shared' });
    await A.engine().syncNow();
    await B.engine().syncNow();
    await A.store.notes.save(n.id, { title: 'A' });
    await B.store.notes.save(n.id, { title: 'B' });
    await A.engine().syncNow();
    const r = await B.engine().syncNow();
    expect(r.status.conflicts).toBe(1);
    const { copyId } = await B.engine().resolve('notes', n.id, 'both');
    await B.engine().syncNow();
    await A.engine().syncNow();
    for (const d of [A, B]) {
      expect((await d.store.notes.get(n.id))?.title).toBe('A');
      expect((await d.store.notes.get(copyId!))?.title).toBe('B (copy from this phone)');
    }
  });

  it('a batch with one stale write is split; the others still upload', async () => {
    const { A, B } = await two();
    const notes = [];
    for (let i = 0; i < 5; i++) notes.push(await A.store.notes.create({ stylePackId: PACK, title: `n${i}` }));
    await A.engine().syncNow();
    await B.engine().syncNow();
    await B.store.notes.save(notes[2]!.id, { title: 'B wins' });
    await B.engine().syncNow();
    for (const [i, n] of notes.entries()) await A.store.notes.save(n.id, { title: `A${i}` });
    const r = await A.engine().syncNow();
    expect(r.push?.conflicts).toBe(1);
    await B.engine().syncNow();
    expect((await B.store.notes.get(notes[0]!.id))?.title).toBe('A0');
    expect((await B.store.notes.get(notes[2]!.id))?.title).toBe('B wins');
  });

  it('a deleted note becomes an erased tombstone in Firestore and is wiped on the other device', async () => {
    const { A, B, uid } = await two();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'Secret', document: SAMPLE_NOTE });
    await A.engine().syncNow();
    await B.engine().syncNow();
    await A.store.notes.remove([n.id]);
    A.raw.prepare('UPDATE notes SET updated = updated - ? WHERE id = ?').run(UNDO_WINDOW_MS + 1, n.id); // past the undo window
    await A.engine().syncNow();
    const snap = await getDocsFromServer(query(collection(A.cloud.firestore, 'notes'), where('owner', '==', uid), limit(10)));
    expect(snap.docs[0]?.data()).toMatchObject({ deleted: true, title: '', document: EMPTY_DOC_JSON, tags: [] });
    await B.engine().syncNow();
    expect(await B.store.notes.get(n.id)).toMatchObject({ deleted: true, title: '' });
    expect(await B.store.search('osmosis')).toEqual([]);
  });

  it('pages through more docs than one page (cursor with nanoseconds and doc ids)', async () => {
    const { A, B } = await two();
    B.ctx().limits = { pageSize: 4 };
    for (let i = 0; i < 10; i++) await A.store.notes.create({ stylePackId: PACK, title: `p${i}` });
    await A.engine().syncNow();
    await B.engine().syncNow();
    expect((await B.store.notes.list({ scope: 'all' })).length).toBe(10);
    await A.store.notes.create({ stylePackId: PACK, title: 'late' });
    await A.engine().syncNow();
    expect((await B.engine().syncNow()).pull?.applied).toBe(1);
  });

  it('an invalid doc written to the cloud is quarantined, never shown', async () => {
    const { A, B, uid } = await two();
    await A.engine().syncNow();
    // A malicious or buggy client writes a note whose document breaks the app's schema
    // (the rules can't look inside the JSON string).
    const bad = { type: 'doc', content: [{ type: 'script', attrs: { blockId: 'b_x' } }] };
    await setDoc(doc(A.cloud.firestore, 'notes', 'n_bad00000000000001'), {
      id: 'n_bad00000000000001', owner: uid, schemaVersion: 1, created: serverTimestamp(), updated: serverTimestamp(), rev: 1, deleted: false,
      subject: null, folder: null, title: 'bad', document: JSON.stringify(bad), inkLayerRef: null, stylePackId: PACK, templateId: null, tags: [],
    });
    const r = await B.engine().syncNow();
    expect(r.pull?.quarantined).toBe(1);
    expect(await B.store.notes.get('n_bad00000000000001')).toBeNull();
  });

  it('an unverified email account cannot sync anything', async () => {
    const C = await makeE2EDevice('C');
    devices.push(C);
    const cred = await createUserWithEmailAndPassword(C.cloud.auth, `unverified.${Date.now()}@example.com`, 'correct horse battery 9');
    await C.start(cred.user.uid);
    await C.store.notes.create({ stylePackId: PACK });
    const r = await C.engine().syncNow();
    expect(r.status.phase).not.toBe('idle');
    expect((await C.store.sync.listOutbox()).length).toBeGreaterThan(0);
  });

  it("another account can't read this account's notes", async () => {
    const { A, uid } = await two();
    await A.store.notes.create({ stylePackId: PACK, title: 'Private' });
    await A.engine().syncNow();
    const M = cloudFor('mallory');
    try {
      await createVerifiedUser(M.auth, `mallory.${Date.now()}@example.com`);
      await expect(getDocsFromServer(query(collection(M.firestore, 'notes'), where('owner', '==', uid), limit(10)))).rejects.toMatchObject({ code: 'permission-denied' });
    } finally {
      await M.close();
    }
  });

  it('asset files go through the real Storage rules, with a merger on both devices', async () => {
    const { A, B, uid } = await two();
    const union = (l: Uint8Array, r: Uint8Array) => enc([...new Set([...dec(l), ...dec(r)])].sort());
    A.mergers.register('ink', union);
    B.mergers.register('ink', union);
    const id = 'a_inkE2E0000000001';
    A.files.set('file:///A/ink.json', enc(['s1']));
    A.raw.prepare(`INSERT INTO assets (id, created, updated, type, size, localPath) VALUES (?, 1, 1, 'ink', 0, 'file:///A/ink.json')`).run(id);
    expect((await A.engine().syncNow()).assets).toMatchObject({ uploaded: 1, failed: 0 });
    await B.engine().syncNow();
    const bPath = await B.engine().ensureLocalFile(id);
    expect(dec(B.files.get(bPath))).toEqual(['s1']);
    A.files.set('file:///A/ink.json', enc(['s1', 'a1']));
    B.files.set(bPath, enc(['s1', 'b1']));
    await A.engine().syncNow();
    expect((await B.engine().syncNow()).assets?.merged).toBe(1);
    await A.engine().syncNow();
    expect(dec(A.files.get('file:///A/ink.json'))).toEqual(['a1', 'b1', 's1']);
    expect(dec(B.files.get(bPath))).toEqual(['a1', 'b1', 's1']);
    expect(uid).toBeTruthy();
  });
});
