/**
 * Sync engine against the rules-faithful fake cloud, with two simulated
 * devices (exit criteria: two devices stay in sync; offline edits on both
 * sides produce a conflict copy instead of lost work).
 */
import { EMPTY_DOC_JSON, makeLongSample, SAMPLE_NOTE } from '@/core';
import { UNDO_WINDOW_MS } from '@/modules/store';

import { ERASED_CARD_FRONT } from '../mapping';
import { CloudTime } from '../time';
import { PACK, setup, settle, snapshot, UID, type Device } from './harness';

const para = (text: string, blockId: string | null = null) => ({
  type: 'paragraph' as const,
  attrs: { blockId },
  content: [{ type: 'text' as const, text }],
});
const doc = (...content: ReturnType<typeof para>[]) => ({ type: 'doc' as const, content });

async function noteText(d: Device, id: string): Promise<string> {
  const n = await d.store.notes.get(id);
  return JSON.stringify(n?.document ?? null);
}

describe('first sync (guest -> account)', () => {
  it('creates the profile first, then uploads everything with rev 1 and the owner', async () => {
    const { A, cloud } = await setup(1);
    const s = await A.store.subjects.create({ name: 'Biology', color: '4F7CF7' });
    const n = await A.store.notes.create({ stylePackId: PACK, subject: s.id, title: 'Osmosis', document: SAMPLE_NOTE });
    await A.enable();
    const r = await A.sync();
    expect(r.status).toMatchObject({ phase: 'idle', pending: 0, conflicts: 0, quarantined: 0 });
    expect(cloud.peek('users', UID)).toMatchObject({ id: UID, owner: UID, rev: 1, deletionRequestedAt: null });
    expect(cloud.peek('notes', n.id)).toMatchObject({ owner: UID, rev: 1, deleted: false, title: 'Osmosis', subject: s.id });
    expect(cloud.peek('subjects', s.id)).toMatchObject({ rev: 1, name: 'Biology', color: '4F7CF7' });
    expect(await A.store.notes.get(n.id)).toMatchObject({ rev: 1, owner: UID });
    // The profile went in its own batch before the rest.
    expect(cloud.stats.commits).toBeGreaterThanOrEqual(2);
  });

  it('does nothing until sync is turned on and bound to this account', async () => {
    const { A, cloud } = await setup(1);
    await A.store.notes.create({ stylePackId: PACK });
    expect((await A.sync()).status.phase).toBe('disabled');
    expect(cloud.count()).toBe(0);
  });

  it('refuses to run for a different account than the one the database is bound to', async () => {
    const { A, cloud } = await setup(1);
    await A.store.sync.bind('someone_else_0000000001');
    await A.store.sync.setEnabled(true);
    await A.store.notes.create({ stylePackId: PACK });
    expect((await A.sync()).status.phase).toBe('disabled');
    expect(cloud.count()).toBe(0);
  });

  it('an unverified email cannot sync (rules require email_verified)', async () => {
    const { A, cloud } = await setup(1, { verified: false });
    await A.store.notes.create({ stylePackId: PACK });
    await A.enable();
    const r = await A.sync();
    expect(r.status.phase).not.toBe('idle');
    expect(cloud.count()).toBe(0);
  });

  it('saves missing block ids locally BEFORE uploading, so every device gets the same ids', async () => {
    const { A, B, cloud } = await setup();
    const long = makeLongSample(2); // P0/P1 samples carry null ids
    const n = await A.store.notes.create({ stylePackId: PACK });
    A.raw.prepare('UPDATE notes SET document = ? WHERE id = ?').run(JSON.stringify(long), n.id);
    await A.enable();
    await A.sync();
    const cloudDoc = JSON.parse(String(cloud.peek('notes', n.id)?.document)) as { content: { attrs?: { blockId?: unknown } }[] };
    expect(cloudDoc.content.every((b) => typeof b.attrs?.blockId === 'string')).toBe(true);
    expect(await noteText(A, n.id)).toBe(JSON.stringify(cloudDoc));
    await B.enable();
    await B.sync();
    expect(await noteText(B, n.id)).toBe(JSON.stringify(cloudDoc));
  });

  it('a second device gets the cloud settings and every note, searchable', async () => {
    const { A, B } = await setup();
    await A.store.settings.update({ defaultPack: 'clear-read' });
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'Mitosis', document: doc(para('chromosomes line up', 'b_A0000000000000x1')) });
    await A.enable();
    await A.sync();
    await B.enable();
    await B.sync();
    expect(await B.store.settings.get()).toMatchObject({ defaultPack: 'clear-read' });
    expect((await B.store.search('chromosomes')).map((h) => h.noteId)).toEqual([n.id]);
    expect(await B.store.sync.listOutbox()).toEqual([]);
  });

  it('guest data on both devices is merged as a union', async () => {
    const { A, B } = await setup();
    const a = await A.store.notes.create({ stylePackId: PACK, title: 'From A' });
    const b = await B.store.notes.create({ stylePackId: PACK, title: 'From B' });
    await A.enable();
    await B.enable();
    await settle([A, B]);
    for (const d of [A, B]) {
      expect((await d.store.notes.list({ scope: 'all' })).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    }
  });
});

describe('two devices stay in sync', () => {
  it('edits on one device reach the other with rev + 1', async () => {
    const { A, B, cloud } = await setup();
    await A.enable();
    await B.enable();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'v1' });
    await settle([A, B]);
    await A.store.notes.save(n.id, { title: 'v2' });
    await A.sync();
    await B.sync();
    expect(await B.store.notes.get(n.id)).toMatchObject({ title: 'v2', rev: 2 });
    expect(cloud.peek('notes', n.id)).toMatchObject({ rev: 2, title: 'v2' });
    expect(snapshot(A)).toEqual(snapshot(B));
  });

  it('an edit made while an upload is in flight is not lost', async () => {
    const { A, B } = await setup();
    await A.enable();
    await B.enable();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'one' });
    await A.sync();
    // Simulate: the row is read and sent, then edited before the ack is recorded.
    const item = await A.store.sync.getOutbox('notes', n.id);
    expect(item).toBeNull();
    await A.store.notes.save(n.id, { title: 'two' });
    const queued = await A.store.sync.getOutbox('notes', n.id);
    await A.store.sync.markSent('notes', n.id, { seq: queued!.seq, rev: 2, hash: 'x' });
    await A.store.notes.save(n.id, { title: 'three' });
    await A.store.sync.markPushed('notes', n.id, { sentSeq: queued!.seq, rev: 1, owner: UID });
    expect(await A.store.sync.getOutbox('notes', n.id)).not.toBeNull();
    await settle([A, B]);
    expect(await B.store.notes.get(n.id)).toMatchObject({ title: 'three' });
  });
});

describe('conflicts (offline edits on both sides)', () => {
  async function twoOfflineEdits() {
    const env = await setup();
    const { A, B } = env;
    await A.enable();
    await B.enable();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'Shared', document: doc(para('base', 'b_A00000000000base')) });
    await settle([A, B]);
    A.remote.setOnline(false);
    B.remote.setOnline(false);
    await A.store.notes.save(n.id, { title: 'A title', document: doc(para('edited on A', 'b_A00000000000base')) });
    await B.store.notes.save(n.id, { title: 'B title', document: doc(para('edited on B', 'b_A00000000000base')) });
    expect((await A.sync()).status.phase).toBe('offline');
    A.remote.setOnline(true);
    B.remote.setOnline(true);
    await A.sync(); // A wins the race to the server
    const r = await B.sync(); // B's write is stale -> conflict
    return { ...env, n, r };
  }

  it('the second upload becomes a conflict, keeps my version on screen and pauses its upload', async () => {
    const { B, n, r, cloud } = await twoOfflineEdits();
    expect(r.status.conflicts).toBe(1);
    expect(await B.store.notes.get(n.id)).toMatchObject({ title: 'B title' });
    expect(await B.store.sync.getOutbox('notes', n.id)).toMatchObject({ state: 'conflict' });
    expect(cloud.peek('notes', n.id)).toMatchObject({ title: 'A title', rev: 2 });
    const [c] = await B.store.sync.listConflicts();
    expect(c).toMatchObject({ kind: 'edit_edit', serverRev: 2 });
    // Syncing again does not overwrite either side.
    await B.sync();
    expect(cloud.peek('notes', n.id)).toMatchObject({ title: 'A title' });
  });

  it('Keep mine uploads my version on top (rev + 1) and both versions stay in History', async () => {
    const { A, B, n, cloud } = await twoOfflineEdits();
    await B.engine.resolve('notes', n.id, 'mine');
    await settle([A, B]);
    expect(cloud.peek('notes', n.id)).toMatchObject({ title: 'B title', rev: 3 });
    expect(await A.store.notes.get(n.id)).toMatchObject({ title: 'B title' });
    const reasons = (await B.store.versions.list(n.id)).map((v) => [v.reason, v.title]);
    expect(reasons).toEqual(expect.arrayContaining([['before_sync_merge', 'B title'], ['before_sync_merge', 'A title']]));
  });

  it('Keep other replaces mine with the server copy', async () => {
    const { A, B, n } = await twoOfflineEdits();
    await B.engine.resolve('notes', n.id, 'other');
    await settle([A, B]);
    expect(await B.store.notes.get(n.id)).toMatchObject({ title: 'A title', rev: 2 });
    expect(await B.store.sync.countConflicts()).toBe(0);
    expect(snapshot(A)).toEqual(snapshot(B));
  });

  it('Keep both keeps the server copy and saves mine as a new note on every device', async () => {
    const { A, B, n } = await twoOfflineEdits();
    const { copyId } = await B.engine.resolve('notes', n.id, 'both');
    await settle([A, B]);
    expect(copyId).toBeTruthy();
    for (const d of [A, B]) {
      expect(await d.store.notes.get(n.id)).toMatchObject({ title: 'A title' });
      expect(await d.store.notes.get(copyId!)).toMatchObject({ title: 'B title (copy from this phone)' });
      expect(await noteText(d, copyId!)).toContain('edited on B');
    }
  });

  it('edit here vs delete there: "deleted on another device"', async () => {
    const { clock, A, B } = await setup();
    await A.enable();
    await B.enable();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'Doomed' });
    await settle([A, B]);
    await A.store.notes.remove([n.id]);
    clock.advance(UNDO_WINDOW_MS + 1);
    await A.sync();
    await B.store.notes.save(n.id, { title: 'Still editing' });
    await B.sync();
    const [c] = await B.store.sync.listConflicts();
    expect(c).toMatchObject({ kind: 'remote_deleted' });
    expect(await B.store.notes.get(n.id)).toMatchObject({ title: 'Still editing', deleted: false });
    // Restore mine: the note comes back on every device.
    await B.engine.resolve('notes', n.id, 'mine');
    await settle([A, B]);
    expect(await A.store.notes.get(n.id)).toMatchObject({ title: 'Still editing', deleted: false });
  });

  it('a pull that finds a newer server copy of a locally edited note makes a conflict too', async () => {
    const { A, B } = await setup();
    await A.enable();
    await B.enable();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'x' });
    await settle([A, B]);
    await A.store.notes.save(n.id, { title: 'A' });
    await A.sync();
    B.remote.setOnline(false);
    await B.store.notes.save(n.id, { title: 'B' });
    B.remote.setOnline(true);
    await B.sync();
    expect(await B.store.sync.countConflicts()).toBe(1);
    expect(await B.store.notes.get(n.id)).toMatchObject({ title: 'B' });
  });

  it('metadata resolves itself: last push wins, and a delete beats an edit', async () => {
    const { clock, A, B } = await setup();
    await A.enable();
    await B.enable();
    const s1 = await A.store.subjects.create({ name: 'Chem', color: '4F7CF7' });
    const s2 = await A.store.subjects.create({ name: 'Phys', color: '4F7CF7' });
    await settle([A, B]);
    await A.store.subjects.update(s1.id, { name: 'Chem A' });
    await B.store.subjects.update(s1.id, { name: 'Chem B' });
    await B.store.subjects.update(s2.id, { name: 'Phys B' });
    await A.store.subjects.remove(s2.id, 'move');
    clock.advance(UNDO_WINDOW_MS + 1);
    await A.sync();
    await B.sync();
    await settle([A, B]);
    expect(await B.store.sync.countConflicts()).toBe(0);
    expect((await A.store.subjects.get(s1.id))?.name).toBe('Chem B');
    expect((await B.store.subjects.get(s1.id))?.name).toBe('Chem B');
    expect((await A.store.subjects.get(s2.id))?.deleted).toBe(true);
    expect((await B.store.subjects.get(s2.id))?.deleted).toBe(true);
  });
});

describe('tombstones (deleted means deleted)', () => {
  it('waits out the undo window, then uploads an erased tombstone that wipes the other device', async () => {
    const { clock, A, B, cloud } = await setup();
    await A.enable();
    await B.enable();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'Secret', tags: ['exam'], document: SAMPLE_NOTE });
    await settle([A, B]);
    await B.store.versions.snapshot(n.id, 'edit');
    await A.store.notes.remove([n.id]);
    await A.sync();
    expect(cloud.peek('notes', n.id)).toMatchObject({ deleted: false, title: 'Secret' }); // still undoable
    clock.advance(UNDO_WINDOW_MS + 1);
    await A.sync();
    expect(cloud.peek('notes', n.id)).toMatchObject({
      deleted: true, title: '', tags: [], document: EMPTY_DOC_JSON, subject: null, folder: null, inkLayerRef: null, templateId: null,
    });
    await B.sync();
    expect(await B.store.notes.get(n.id)).toMatchObject({ deleted: true, title: '' });
    expect(await B.store.search('osmosis')).toEqual([]);
    expect(await B.store.versions.list(n.id)).toEqual([]);
  });

  it('undo inside the window means the cloud never sees the delete', async () => {
    const { A, cloud } = await setup(1);
    await A.enable();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'Oops' });
    await A.sync();
    const token = await A.store.notes.remove([n.id]);
    await A.sync();
    await A.store.undo(token);
    await A.sync();
    expect(cloud.peek('notes', n.id)).toMatchObject({ deleted: false, title: 'Oops' });
  });

  it('a note created and deleted before it ever synced is never uploaded', async () => {
    const { clock, A, cloud } = await setup(1);
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'Draft' });
    await A.store.notes.remove([n.id]);
    clock.advance(UNDO_WINDOW_MS + 1);
    await A.enable();
    await A.sync();
    expect(cloud.peek('notes', n.id)).toBeUndefined();
    expect(await A.store.sync.listOutbox()).toEqual([]);
  });

  it('erases card text in a card tombstone', async () => {
    const { clock, A, cloud } = await setup(1);
    await A.enable();
    A.raw.exec(`INSERT INTO cards (id, created, updated, type, front, back, source) VALUES ('c_A000000000000001', ${clock.now()}, ${clock.now()}, 'basic', 'What is osmosis?', 'Water moving', 'manual')`);
    await A.sync();
    A.raw.exec(`UPDATE cards SET deleted = 1, updated = ${clock.now()} WHERE id = 'c_A000000000000001'`);
    clock.advance(UNDO_WINDOW_MS + 1);
    await A.sync();
    expect(cloud.peek('cards', 'c_A000000000000001')).toMatchObject({ deleted: true, front: ERASED_CARD_FRONT, back: '', note: null });
  });
});

describe('unreliable networks', () => {
  it('a lost acknowledgement is recognised as our own write (no conflict)', async () => {
    const { A, B, cloud } = await setup();
    await A.enable();
    await B.enable();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'v1' });
    await settle([A, B]);
    await A.store.notes.save(n.id, { title: 'v2' });
    A.remote.loseNextAck();
    expect((await A.sync()).status.phase).toBe('offline');
    expect(cloud.peek('notes', n.id)).toMatchObject({ title: 'v2', rev: 2 }); // it landed
    const r = await A.sync();
    expect(r.status).toMatchObject({ phase: 'idle', conflicts: 0, pending: 0 });
    expect(await A.store.notes.get(n.id)).toMatchObject({ rev: 2 });
  });

  it('a lost ack followed by another edit uploads rev + 1 without a conflict', async () => {
    const { A, cloud } = await setup(1);
    await A.enable();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'v1' });
    await A.sync();
    await A.store.notes.save(n.id, { title: 'v2' });
    A.remote.loseNextAck();
    await A.sync();
    await A.store.notes.save(n.id, { title: 'v3' });
    const r = await A.sync();
    expect(r.status.conflicts).toBe(0);
    expect(cloud.peek('notes', n.id)).toMatchObject({ title: 'v3', rev: 3 });
  });

  it('a lost ack on the very first upload (create) is recognised too', async () => {
    const { A, cloud } = await setup(1);
    await A.enable();
    await A.sync();
    const n = await A.store.notes.create({ stylePackId: PACK, title: 'new' });
    A.remote.loseNextAck();
    await A.sync();
    const r = await A.sync();
    expect(r.status).toMatchObject({ conflicts: 0, pending: 0, quarantined: 0 });
    expect(cloud.peek('notes', n.id)).toMatchObject({ rev: 1 });
  });

  it('a rejected batch is split until the one stale write is found; the rest still upload', async () => {
    const { A, B, cloud } = await setup();
    await A.enable();
    await B.enable();
    const notes = [];
    for (let i = 0; i < 9; i++) notes.push(await A.store.notes.create({ stylePackId: PACK, title: `n${i}` }));
    await settle([A, B]);
    await B.store.notes.save(notes[4]!.id, { title: 'B wins' });
    await B.sync();
    for (const [i, n] of notes.entries()) await A.store.notes.save(n.id, { title: `A${i}` });
    const r = await A.sync();
    expect(r.push?.conflicts).toBe(1);
    for (const [i, n] of notes.entries()) {
      expect(cloud.peek('notes', n.id)?.title).toBe(i === 4 ? 'B wins' : `A${i}`);
    }
  });
});

describe('validation and quarantine', () => {
  it('an invalid cloud doc is quarantined, never applied, and the pull moves on', async () => {
    const { A, cloud, clock } = await setup(1);
    await A.enable();
    await A.sync();
    const t = CloudTime.fromMillis(clock.now() + 5);
    const good = { id: 'n_X000000000000001', owner: UID, schemaVersion: 1, created: t, updated: t, rev: 1, deleted: false, subject: null, folder: null, title: 'ok', document: JSON.stringify(doc(para('fine', 'b_X0000000000001'))), inkLayerRef: null, stylePackId: PACK, templateId: null, tags: [] };
    cloud.adminSet('notes', 'n_X000000000000002', { ...good, id: 'n_X000000000000002', document: '{"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":null}}]}' });
    cloud.adminSet('notes', 'n_X000000000000003', { ...good, id: 'n_X000000000000003', evil: '<script>' });
    cloud.adminSet('notes', good.id, good);
    const r = await A.sync();
    expect(r.pull).toMatchObject({ applied: 1, quarantined: 2 });
    expect(await A.store.notes.get('n_X000000000000002')).toBeNull();
    expect(await A.store.notes.get(good.id)).toMatchObject({ title: 'ok' });
    expect((await A.store.sync.listQuarantine()).map((q) => [q.id, q.direction])).toEqual(
      expect.arrayContaining([['n_X000000000000002', 'in'], ['n_X000000000000003', 'in']]),
    );
    // The quarantine never stores content.
    expect(JSON.stringify(await A.store.sync.listQuarantine())).not.toContain('script');
  });

  it('an invalid local row is quarantined instead of retried forever, and the rest upload', async () => {
    const { A, cloud } = await setup(1);
    const ok = await A.store.subjects.create({ name: 'Fine', color: '4F7CF7' });
    A.raw.exec(`INSERT INTO subjects (id, created, updated, name, color, icon) VALUES ('s_A0000000000000bad', 1, 1, '${'x'.repeat(81)}', 'AABBCC', 'book')`);
    await A.enable();
    const r = await A.sync();
    expect(r.status.quarantined).toBe(1);
    expect(cloud.peek('subjects', ok.id)).toBeDefined();
    expect(cloud.peek('subjects', 's_A0000000000000bad')).toBeUndefined();
    expect(await A.store.sync.getOutbox('subjects', 's_A0000000000000bad')).toMatchObject({ state: 'quarantined' });
  });

  it('pages through many docs, including docs with the same millisecond', async () => {
    const { A, B } = await setup(2, { limits: { pageSize: 3, batchSize: 4 } });
    await A.enable();
    await B.enable();
    for (let i = 0; i < 11; i++) await A.store.notes.create({ stylePackId: PACK, title: `p${i}` });
    await A.sync();
    await B.sync();
    expect((await B.store.notes.list({ scope: 'all' })).length).toBe(11);
    // Incremental: only newer docs are applied next time.
    await A.store.notes.create({ stylePackId: PACK, title: 'late' });
    await A.sync();
    const r = await B.sync();
    expect(r.pull?.applied).toBe(1);
  });
});

describe('review logs (append-only, union merge)', () => {
  it('logs from two offline devices end up on both, once each', async () => {
    const { A, B, cloud, clock } = await setup();
    await A.enable();
    await B.enable();
    A.raw.exec(`INSERT INTO cards (id, created, updated, type, front, back, source) VALUES ('c_A000000000000001', 1, 1, 'basic', 'Q', 'A', 'manual')`);
    await settle([A, B]);
    const t = clock.now();
    A.raw.exec(`INSERT INTO reviewLogs (id, created, card, rating, reviewedAt, device) VALUES ('r_A000000000000001', ${t}, 'c_A000000000000001', 3, ${t}, 'devA')`);
    B.raw.exec(`INSERT INTO reviewLogs (id, created, card, rating, reviewedAt, device) VALUES ('r_B000000000000001', ${t}, 'c_A000000000000001', 1, ${t}, 'devB')`);
    await settle([A, B]);
    for (const d of [A, B]) {
      expect((d.raw.prepare('SELECT id FROM reviewLogs ORDER BY id').all() as { id: string }[]).map((r) => r.id)).toEqual(['r_A000000000000001', 'r_B000000000000001']);
    }
    expect(cloud.all('reviewLogs')).toHaveLength(2);
    // Re-uploading an existing log is a no-op, not an error.
    await A.store.sync.requeue('reviewLogs', 'r_A000000000000001');
    const r = await A.sync();
    expect(r.status).toMatchObject({ pending: 0, quarantined: 0 });
  });
});

describe('account gone', () => {
  it('stops syncing when the account was deleted on another device', async () => {
    const { A, cloud } = await setup(1);
    await A.enable();
    await A.store.notes.create({ stylePackId: PACK });
    await A.sync();
    const p = cloud.peek('users', UID)!;
    cloud.adminSet('users', UID, { ...p, deletionRequestedAt: CloudTime.fromMillis(Date.now()) });
    await A.store.notes.create({ stylePackId: PACK, title: 'after' });
    const r = await A.sync();
    expect(r.status.phase).toBe('account_gone');
    expect((await A.store.sync.getState()).enabled).toBe(false);
    // Local notes stay.
    expect((await A.store.notes.list({ scope: 'all' })).length).toBe(2);
  });

  it('also when the profile is already gone', async () => {
    const { A, cloud } = await setup(1);
    await A.enable();
    await A.sync();
    cloud.adminDelete('users', UID);
    expect((await A.sync()).status.phase).toBe('account_gone');
  });
});

describe('single flight', () => {
  it('concurrent syncNow calls share one run and queue one more', async () => {
    const { A, cloud } = await setup(1);
    await A.enable();
    await A.store.notes.create({ stylePackId: PACK });
    const [r1, r2] = await Promise.all([A.sync(), A.sync()]);
    expect(r1).toBe(r2);
    expect(r1.status.pending).toBe(0);
    expect(cloud.all('notes')).toHaveLength(1);
  });
});
