import { createLogger, createSeqIdGenerator, memorySink, type NoteDoc } from '@/core';
import { openStore } from '@/modules/store';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { createNoteSession } from '../noteSession';

const doc = (text: string): NoteDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('note editing session', () => {
  it('saves edits, notices outside changes, and writes a leave version', async () => {
    let t = Date.UTC(2026, 10, 1);
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }), now: () => (t += 1000) });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('v1') });
    const banners: (string | null)[] = [];
    const s = createNoteSession({ store, noteId: n.id, onBanner: (b) => banners.push(b), now: () => t });
    s.seen(n.updated);
    expect(s.changedElsewhere(n.updated)).toBe(false);
    s.edited(doc('v2'));
    await s.autosave.flush();
    const saved = await store.notes.get(n.id);
    expect(JSON.stringify(saved?.document)).toContain('v2');
    expect(s.changedElsewhere(saved!.updated)).toBe(false); // our own save
    const r = await store.notes.save(n.id, { stylePackId: 'clear-read' }); // e.g. the Style sheet
    expect(s.changedElsewhere(r.note.updated)).toBe(true);
    await s.leave();
    expect((await store.versions.list(n.id)).map((v) => v.reason)).toContain('leave');
    expect(banners.every((b) => b === null)).toBe(true);
  });
});
