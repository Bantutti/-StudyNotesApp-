import { createServicesWith, type Adapters } from '../services';

const KEY = 'gsk_' + 'z'.repeat(52);

function adapters(over: Partial<Adapters> = {}): Adapters {
  let file: string | null = null;
  const secrets = new Map<string, string>();
  return {
    resultsFile: { read: async () => file, write: async (c) => void (file = c) },
    secretStore: { get: async (k) => secrets.get(k) ?? null, set: async (k, v) => void secrets.set(k, v), remove: async (k) => void secrets.delete(k) },
    print: { printToFile: async () => ({ uri: 'file:///x.pdf' }), print: async () => undefined },
    files: { writeBytes: async (n, b) => ({ uri: `file:///${n}`, size: b.length }), sizeOf: () => 10 },
    share: { share: async () => undefined },
    readAsset: async () => 'AAAA',
    fetchFn: (async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch,
    fileSize: () => 1,
    randomBytes: (n) => new Uint8Array(n).fill(7),
    device: { os: 'android', osVersion: '15', model: 'Test', runtime: 'expo-go', isTablet: false },
    isDev: false,
    linkPorts: { openExternal: async () => undefined, confirm: async () => false },
    database: { openDriver: async () => { throw new Error('unused'); }, deleteDatabase: async () => undefined, wipeFiles: async () => undefined },
    ...over,
  };
}

describe('composition root', () => {
  it('wires the key vault into the transcriber', async () => {
    const calls: string[] = [];
    const s = createServicesWith(
      adapters({
        fetchFn: (async (_u: unknown, init?: RequestInit) => {
          calls.push(String((init?.headers as Record<string, string>).Authorization));
          return { ok: true, status: 200, json: async () => ({}) };
        }) as unknown as typeof fetch,
      }),
    );
    await expect(s.transcriber.testKey()).rejects.toMatchObject({ code: 'missing_key' });
    await s.keyVault.set('groq', KEY);
    expect(await s.transcriber.testKey()).toBe(true);
    expect(calls).toEqual([`Bearer ${KEY}`]);
  });

  it('caches font faces per font pair', async () => {
    let reads = 0;
    const s = createServicesWith(adapters({ readAsset: async () => { reads++; return 'AAAA'; } }));
    const pack = s.packs.getOrDefault('pastel-highlight');
    await s.getFaces(pack);
    const first = reads;
    await s.getFaces(pack);
    expect(reads).toBe(first);
    expect(first).toBeGreaterThan(0);
  });

  it('records results with the injected device info', async () => {
    const s = createServicesWith(adapters());
    const r = await s.results.record({ spike: 'review', verdict: 'pass', summary: 'ok', metrics: {} });
    expect(r.device.model).toBe('Test');
    expect(s.notes.get().isSample).toBe(true);
  });
});
