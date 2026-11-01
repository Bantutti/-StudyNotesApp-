import { createLogger, createSeqIdGenerator, memorySink, type NoteDoc } from '@/core';
import { openStore, type SaveResult } from '@/modules/store';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { createAutosave } from '../autosave';
import { checkpointOnLeave, checkpointWhileEditing, EDIT_CHECKPOINT_MS } from '../versions';

function clock() {
  let t = Date.UTC(2026, 10, 1);
  const q: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      q.push({ at: t + ms, fn, id: ++id });
      return id;
    },
    clearTimer: (h: unknown) => {
      const i = q.findIndex((x) => x.id === h);
      if (i >= 0) q.splice(i, 1);
    },
    async advance(ms: number) {
      t += ms;
      for (;;) {
        const due = q.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        q.splice(q.indexOf(due), 1);
        due.fn();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}
const doc = (text: string): NoteDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const ok = { note: {} as SaveResult['note'], usage: 0 } as SaveResult;

describe('autosave', () => {
  it('saves 1 s after the last change', async () => {
    const c = clock();
    const saved: string[] = [];
    const a = createAutosave({ save: async (d) => (saved.push(JSON.stringify(d)), ok), checkpoint: async () => undefined, ...c });
    a.change(doc('a'));
    await c.advance(500);
    a.change(doc('ab'));
    await c.advance(900);
    expect(saved).toHaveLength(0);
    await c.advance(100);
    expect(saved).toEqual([JSON.stringify(doc('ab'))]);
  });

  it('saves at least every 5 s while typing continuously', async () => {
    const c = clock();
    let saves = 0;
    const a = createAutosave({ save: async () => (saves++, ok), checkpoint: async () => undefined, ...c });
    for (let i = 0; i < 12; i++) {
      a.change(doc(`t${i}`));
      await c.advance(500); // never pauses 1 s
    }
    expect(saves).toBeGreaterThanOrEqual(1);
  });

  it('flush saves immediately and keeps saves in order', async () => {
    const c = clock();
    const saved: string[] = [];
    let release: () => void = () => undefined;
    const a = createAutosave({
      save: (d) =>
        new Promise((res) => {
          saved.push(JSON.stringify(d));
          release = () => res(ok);
        }),
      checkpoint: async () => undefined,
      ...c,
    });
    a.change(doc('one'));
    const f = a.flush();
    a.change(doc('two')); // arrives while "one" is saving
    await new Promise((r) => setTimeout(r, 0)); // let the save of "one" start
    release();
    await f;
    await c.advance(1_000);
    await new Promise((r) => setTimeout(r, 0));
    release();
    await a.flush();
    expect(saved).toEqual([JSON.stringify(doc('one')), JSON.stringify(doc('two'))]);
  });

  it('keeps a failed change and retries it', async () => {
    const c = clock();
    let fail = true;
    const saved: string[] = [];
    const errors: unknown[] = [];
    const a = createAutosave({
      save: async (d) => {
        if (fail) throw new Error('disk full');
        saved.push(JSON.stringify(d));
        return ok;
      },
      checkpoint: async () => undefined,
      onError: (e) => errors.push(e),
      ...c,
    });
    a.change(doc('keep me'));
    await a.flush();
    expect(errors).toHaveLength(1);
    expect(a.hasPending).toBe(true);
    fail = false;
    await a.flush();
    expect(saved).toEqual([JSON.stringify(doc('keep me'))]);
    expect(a.hasPending).toBe(false);
  });

  it('reset drops pending changes (a document an action already stored)', async () => {
    const c = clock();
    let saves = 0;
    const a = createAutosave({ save: async () => (saves++, ok), checkpoint: async () => undefined, ...c });
    a.change(doc('x'));
    a.reset();
    await c.advance(10_000);
    expect(saves).toBe(0);
  });

  it('with the real store: edit checkpoints every 10 minutes and a leave version', async () => {
    const c = clock();
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }), now: c.now });
    const n = await store.notes.create({ stylePackId: 'pastel-highlight', document: doc('start') });
    const a = createAutosave({
      save: (d) => store.notes.save(n.id, { document: d }),
      checkpoint: () => checkpointWhileEditing(store, n.id, c.now()),
      ...c,
    });
    a.change(doc('first edit'));
    await a.flush(); // first save: checkpoint of "start"
    for (let i = 0; i < 5; i++) {
      a.change(doc(`edit ${i}`));
      await c.advance(2 * 60_000); // 10 minutes in total
    }
    a.change(doc('after ten minutes'));
    await c.advance(EDIT_CHECKPOINT_MS);
    await a.flush();
    const reasons = (await store.versions.list(n.id)).map((v) => v.reason);
    // versions at 0 min (first save), 10 min and 20 min of editing
    expect(reasons.filter((r) => r === 'edit').length).toBe(3);
    expect(a.changedThisSession).toBe(true);
    expect(await checkpointOnLeave(store, n.id, a.changedThisSession)).toBe(true);
    expect(JSON.stringify((await store.notes.get(n.id))?.document)).toContain('after ten minutes');
  });
});
