import { maskKey, normalizeKey } from '../keyFormat';
import { createKeyVault, type SecretStorePort } from '../keyVault';

const KEY = 'gsk_' + 'Ab3'.repeat(17);

function memStore(): SecretStorePort & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}

describe('BYOK keys', () => {
  it('trims pasted keys and validates the format', () => {
    expect(normalizeKey('groq', `  ${KEY}\n`)).toEqual({ ok: true, value: KEY });
    expect(normalizeKey('groq', 'sk-not-groq').ok).toBe(false);
    expect(normalizeKey('groq', 'gsk_short').ok).toBe(false);
  });
  it('masks keys for display', () => {
    expect(maskKey(KEY)).toBe(`gsk_…${KEY.slice(-4)}`);
    expect(maskKey('abc')).toBe('••••');
  });
  it('vault stores only valid, trimmed keys under a fixed slot', async () => {
    const store = memStore();
    const vault = createKeyVault(store);
    await expect(vault.set('groq', 'nope')).rejects.toMatchObject({ code: 'invalid_key' });
    expect(store.data.size).toBe(0);
    await vault.set('groq', ` ${KEY} `);
    expect([...store.data.entries()]).toEqual([['ai.groq.apiKey', KEY]]);
    expect(await vault.has('groq')).toBe(true);
    await vault.remove('groq');
    expect(await vault.get('groq')).toBeNull();
  });
});
