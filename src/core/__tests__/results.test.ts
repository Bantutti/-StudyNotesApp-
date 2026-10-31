import { createLogger, memorySink } from '../logger';
import { createSeqIdGenerator } from '../ids';
import { createResultsStore, MAX_RESULTS, resultsToMarkdown, type TextFilePort } from '../results';

const device = { os: 'android' as const, osVersion: '15', model: 'Pixel 7', runtime: 'expo-go' as const, isTablet: false };

function memFile(initial: string | null = null): TextFilePort & { content: string | null } {
  const f = {
    content: initial,
    read: async () => f.content,
    write: async (c: string) => {
      f.content = c;
    },
  };
  return f;
}

const make = (file = memFile()) =>
  createResultsStore({ file, ids: createSeqIdGenerator(), device, logger: createLogger({ sink: memorySink() }), now: () => new Date('2026-11-01T00:00:00Z') });

describe('results store', () => {
  it('records and lists results', async () => {
    const store = make();
    await store.record({ spike: 'review', verdict: 'pass', summary: 'ok', metrics: { golden: 8 } });
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ spike: 'review', verdict: 'pass', device });
  });

  it('skips corrupted or tampered lines', async () => {
    const file = memFile('not json\n{"id":"bad"}\n');
    const store = make(file);
    await store.record({ spike: 'ink', verdict: 'info', summary: 's', metrics: {} });
    expect(await store.list()).toHaveLength(1);
  });

  it('rejects metrics that could carry content', async () => {
    const store = make();
    await expect(store.record({ spike: 'ink', verdict: 'info', summary: 's', metrics: { note: 'x'.repeat(500) } })).rejects.toThrow();
    await expect(store.record({ spike: 'ink', verdict: 'info', summary: 's', metrics: { 'bad key!': 1 } })).rejects.toThrow();
  });

  it('keeps at most MAX_RESULTS entries', async () => {
    const lines = Array.from({ length: MAX_RESULTS }, (_, i) =>
      JSON.stringify({ id: `r_${String(i).padStart(16, '0')}`, spike: 'ink', at: 'x', verdict: 'info', summary: '', device, metrics: {} }),
    ).join('\n');
    const store = make(memFile(lines));
    await store.record({ spike: 'ink', verdict: 'pass', summary: 'new', metrics: {} });
    const all = await store.list();
    expect(all).toHaveLength(MAX_RESULTS);
    expect(all[all.length - 1]?.summary).toBe('new');
  });

  it('renders markdown', async () => {
    const store = make();
    await store.record({ spike: 'export', verdict: 'fail', summary: 'PDF ok', metrics: { pdf_ms: 400, odd: 'a|b' } });
    const md = resultsToMarkdown(await store.list());
    expect(md).toContain('## export: FAIL');
    expect(md).toContain('| odd | a/b |');
    expect(resultsToMarkdown([])).toContain('No spike results');
  });
});
