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

  it('honors max wait even when the clock starts at zero', async () => {
    let time = 0;
    let due: { fn: () => void; at: number } | null = null;
    const save = jest.fn(async () => ok);
    const a = createAutosave({
      save,
      checkpoint: async () => undefined,
      now: () => time,
      setTimer: (fn, ms) => { due = { fn, at: time + ms }; return due; },
      clearTimer: () => { due = null; },
    });
    for (let i = 0; i < 10; i++) {
      a.change(doc(`${i}`));
      time += 500;
    }
    expect((due as { fn: () => void; at: number } | null)?.at).toBe(5_000);
    a.dispose();
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
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toEqual([JSON.stringify(doc('one')), JSON.stringify(doc('two'))]);
    release();
    await f;
    expect(a.hasPending).toBe(false);
    await c.advance(1_000);
    expect(saved).toHaveLength(2);
  });

  it('overlapping flushes both wait for the newer in-flight save', async () => {
    const c = clock();
    const releases: (() => void)[] = [];
    const saved: NoteDoc[] = [];
    const a = createAutosave({
      save: (d) => new Promise((resolve) => {
        saved.push(d);
        releases.push(() => resolve(ok));
      }),
      checkpoint: async () => undefined,
      ...c,
    });
    a.change(doc('first'));
    let firstFinished = false;
    const first = a.flush().then(() => { firstFinished = true; });
    a.change(doc('newer'));
    let secondFinished = false;
    const second = a.flush().then(() => { secondFinished = true; });
    await new Promise((r) => setTimeout(r, 0));
    releases[0]!();
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toEqual([doc('first'), doc('newer')]);
    expect(firstFinished).toBe(false);
    expect(secondFinished).toBe(false);
    releases[1]!();
    await Promise.all([first, second]);
    expect(a.hasPending).toBe(false);
    a.dispose();
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

  it('pauses after persistent save failures until a new edit, then pauses again', async () => {
    const c = clock();
    const attempted: NoteDoc[] = [];
    const errors: unknown[] = [];
    const a = createAutosave({
      save: async (d) => { attempted.push(d); throw new Error('disk full'); },
      checkpoint: async () => undefined,
      onError: (e) => errors.push(e),
      ...c,
    });
    a.change(doc('first'));
    await c.advance(1_000);
    await c.advance(20_000);
    expect(attempted).toEqual([doc('first')]);
    expect(a.hasPending).toBe(true);
    a.change(doc('newest'));
    await c.advance(999);
    expect(attempted).toHaveLength(1); // the old failed timestamp must not bypass debounce
    await c.advance(1);
    await c.advance(20_000);
    expect(attempted).toEqual([doc('first'), doc('newest')]);
    expect(errors).toHaveLength(2);
    expect(a.hasPending).toBe(true);
    a.dispose();
  });

  it('a new edit after failure retries and saves the newest document', async () => {
    const c = clock();
    let fail = true;
    const save = jest.fn(async (_doc: NoteDoc) => { if (fail) throw new Error('disk full'); return ok; });
    const a = createAutosave({ save, checkpoint: async () => undefined, ...c });
    a.change(doc('old'));
    await c.advance(1_000);
    expect(a.hasPending).toBe(true);
    fail = false;
    a.change(doc('new'));
    await c.advance(1_000);
    expect(save.mock.calls.map(([d]) => d)).toEqual([doc('old'), doc('new')]);
    expect(a.hasPending).toBe(false);
    a.dispose();
  });

  it('can retry after a dependency throws synchronously', async () => {
    const c = clock();
    let fail = true;
    const save = jest.fn(async () => ok);
    const a = createAutosave({
      save,
      checkpoint: () => { if (fail) throw new Error('synchronous failure'); return Promise.resolve(); },
      ...c,
    });
    a.change(doc('pending'));
    await a.flush();
    expect(a.hasPending).toBe(true);
    fail = false;
    await a.flush();
    expect(save).toHaveBeenCalledWith(doc('pending'));
    expect(a.hasPending).toBe(false);
    a.dispose();
  });

  it('an explicit flush retries a failed checkpoint and saves the pending document', async () => {
    const c = clock();
    let fail = true;
    const save = jest.fn(async () => ok);
    const errors: unknown[] = [];
    const a = createAutosave({
      save,
      checkpoint: async () => { if (fail) throw new Error('checkpoint failed'); },
      onError: (e) => errors.push(e),
      ...c,
    });
    a.change(doc('pending'));
    await a.flush();
    await c.advance(20_000);
    expect(errors).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    expect(a.hasPending).toBe(true);
    fail = false;
    await a.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(doc('pending'));
    expect(a.hasPending).toBe(false);
    a.dispose();
  });

  it('retains a newer in-flight edit and tries it once even if its timer fired before the old save failed', async () => {
    const c = clock();
    const attempted: NoteDoc[] = [];
    let rejectOld: (e: Error) => void = () => undefined;
    const a = createAutosave({
      save: (d) => {
        attempted.push(d);
        if (attempted.length === 1) return new Promise<SaveResult>((_, reject) => { rejectOld = reject; });
        return Promise.reject(new Error('still full'));
      },
      checkpoint: async () => undefined,
      ...c,
    });
    a.change(doc('old'));
    await c.advance(1_000);
    a.change(doc('new'));
    await c.advance(1_000); // the new edit's timer waits for the old save
    rejectOld(new Error('full'));
    await new Promise((r) => setTimeout(r, 0));
    await c.advance(0);
    await c.advance(20_000);
    expect(attempted).toEqual([doc('old'), doc('new')]);
    expect(a.hasPending).toBe(true);
    a.dispose();
  });

  it('flush called during a failed in-flight save retries the latest edit without concurrent writes', async () => {
    const c = clock();
    const attempted: NoteDoc[] = [];
    let rejectOld: (e: Error) => void = () => undefined;
    const a = createAutosave({
      save: (d) => {
        attempted.push(d);
        if (attempted.length === 1) return new Promise<SaveResult>((_, reject) => { rejectOld = reject; });
        return Promise.resolve(ok);
      },
      checkpoint: async () => undefined,
      ...c,
    });
    a.change(doc('old'));
    await c.advance(1_000);
    a.change(doc('new'));
    const flushing = a.flush();
    expect(attempted).toEqual([doc('old')]);
    rejectOld(new Error('full'));
    await flushing;
    expect(attempted).toEqual([doc('old'), doc('new')]);
    expect(a.hasPending).toBe(false);
    await c.advance(10_000);
    expect(attempted).toHaveLength(2);
    a.dispose();
  });

  it('an explicit flush joining a failing save retries once and then pauses', async () => {
    const c = clock();
    let rejectFirst: (e: Error) => void = () => undefined;
    const save = jest.fn(() => {
      if (save.mock.calls.length === 1) return new Promise<SaveResult>((_, reject) => { rejectFirst = reject; });
      return Promise.reject(new Error('still full'));
    });
    const a = createAutosave({ save, checkpoint: async () => undefined, ...c });
    a.change(doc('pending'));
    await c.advance(1_000);
    const flushing = a.flush();
    rejectFirst(new Error('full'));
    await flushing;
    expect(save).toHaveBeenCalledTimes(2);
    expect(a.hasPending).toBe(true);
    await c.advance(20_000);
    expect(save).toHaveBeenCalledTimes(2);
    a.dispose();
  });

  it('reset during a failed save does not resurrect the already-replaced document', async () => {
    const c = clock();
    let rejectOld: (e: Error) => void = () => undefined;
    const a = createAutosave({
      save: () => new Promise<SaveResult>((_, reject) => { rejectOld = reject; }),
      checkpoint: async () => undefined,
      ...c,
    });
    a.change(doc('old'));
    await c.advance(1_000);
    a.reset();
    rejectOld(new Error('full'));
    await c.advance(0);
    expect(a.hasPending).toBe(false);
    a.dispose();
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
