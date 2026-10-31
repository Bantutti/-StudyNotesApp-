import { createLogger, createSeqIdGenerator, memorySink, SAMPLE_NOTE } from '@/core';
import { openStore, type SearchHit } from '@/modules/store';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { createSearchController, type SearchState } from '../search';

function timers() {
  const q: { fn: () => void; id: number }[] = [];
  let id = 0;
  return {
    setTimer: (fn: () => void) => {
      q.push({ fn, id: ++id });
      return id;
    },
    clearTimer: (h: unknown) => {
      const i = q.findIndex((x) => x.id === h);
      if (i >= 0) q.splice(i, 1);
    },
    fire: () => q.splice(0).forEach((x) => x.fn()),
    pending: () => q.length,
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('search controller', () => {
  it('debounces typing into one search and shows its results', async () => {
    const calls: string[] = [];
    const t = timers();
    const states: SearchState[] = [];
    const c = createSearchController({
      search: async (q) => {
        calls.push(q);
        return [{ noteId: 'n1' } as SearchHit];
      },
      onChange: (s) => states.push(s),
      ...t,
    });
    c.setQuery('o');
    c.setQuery('os');
    c.setQuery('osmo');
    expect(t.pending()).toBe(1);
    expect(c.state.busy).toBe(true);
    t.fire();
    await flush();
    expect(calls).toEqual(['osmo']);
    expect(c.state).toMatchObject({ query: 'osmo', busy: false, hits: [{ noteId: 'n1' }] });
  });

  it('ignores a slow answer for an older query', async () => {
    const t = timers();
    const resolvers: ((h: SearchHit[]) => void)[] = [];
    const c = createSearchController({ search: () => new Promise((r) => resolvers.push(r)), onChange: () => undefined, ...t });
    c.setQuery('cell');
    t.fire();
    c.setQuery('cells');
    t.fire();
    resolvers[1]?.([{ noteId: 'new' } as SearchHit]);
    await flush();
    resolvers[0]?.([{ noteId: 'old' } as SearchHit]);
    await flush();
    expect(c.state.hits.map((h) => h.noteId)).toEqual(['new']);
  });

  it('clears results for an empty query without searching', () => {
    const t = timers();
    const c = createSearchController({ search: async () => [], onChange: () => undefined, ...t });
    c.setQuery('   ');
    expect(t.pending()).toBe(0);
    expect(c.state).toMatchObject({ hits: [], busy: false });
  });

  it('works end to end on the real index (exit criterion: search finds words in notes)', async () => {
    const store = await openStore(nodeSqliteDriver(), { ids: createSeqIdGenerator(), logger: createLogger({ sink: memorySink() }) });
    await store.notes.create({ stylePackId: 'pastel-highlight', title: 'Osmosis & Diffusion', document: SAMPLE_NOTE });
    const t = timers();
    const c = createSearchController({ search: store.search, onChange: () => undefined, ...t });
    c.setQuery('hyperton');
    t.fire();
    await flush();
    await flush();
    expect(c.state.hits).toHaveLength(1);
    expect(c.state.hits[0]?.matches[0]?.snippet.some((p) => p.match)).toBe(true);
  });
});
