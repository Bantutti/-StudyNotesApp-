/**
 * Where Firebase Auth keeps the signed-in session (refresh token, ID token)
 * on the phone: the Keychain / Keystore through expo-secure-store, never a
 * plain file (decision Q8). Firebase's React Native default is AsyncStorage,
 * which is a plain file in the app sandbox.
 *
 * SecureStore limits (expo-secure-store docs): keys are [A-Za-z0-9._-] and
 * values should stay under 2048 bytes. Firebase's keys contain ':' and '['
 * and a session is larger than 2 KB, so keys are encoded and values are
 * split into chunks: `<key>.n` holds the count, `<key>.0..n-1` the parts.
 * A write removes chunks left over from a longer previous value.
 */
export interface SecureStorePort {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** The storage shape Firebase's getReactNativePersistence() expects. */
export interface AsyncKeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const CHUNK_CHARS = 1800;
const MAX_CHUNKS = 64;

/** Firebase key -> a SecureStore-safe key ("fbauth_" + hex of the UTF-16 units). */
export function encodeKey(key: string): string {
  let hex = '';
  for (let i = 0; i < key.length && i < 120; i++) hex += key.charCodeAt(i).toString(16).padStart(4, '0');
  return `fbauth_${hex}`;
}

export function createSecureKeyValue(store: SecureStorePort): AsyncKeyValue {
  const countOf = async (k: string): Promise<number> => {
    const n = Number(await store.getItemAsync(`${k}.n`));
    return Number.isInteger(n) && n > 0 && n <= MAX_CHUNKS ? n : 0;
  };
  const removeChunks = async (k: string, from: number, to: number) => {
    for (let i = from; i < to; i++) await store.deleteItemAsync(`${k}.${i}`);
  };
  return {
    async getItem(key) {
      const k = encodeKey(key);
      const n = await countOf(k);
      if (n === 0) return null;
      let out = '';
      for (let i = 0; i < n; i++) {
        const part = await store.getItemAsync(`${k}.${i}`);
        if (part === null) return null; // torn write: treat as signed out
        out += part;
      }
      return out;
    },
    async setItem(key, value) {
      const k = encodeKey(key);
      const parts: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_CHARS) parts.push(value.slice(i, i + CHUNK_CHARS));
      if (parts.length === 0) parts.push('');
      if (parts.length > MAX_CHUNKS) throw new Error('secure_value_too_large');
      const old = await countOf(k);
      for (const [i, p] of parts.entries()) await store.setItemAsync(`${k}.${i}`, p);
      await store.setItemAsync(`${k}.n`, String(parts.length));
      await removeChunks(k, parts.length, old);
    },
    async removeItem(key) {
      const k = encodeKey(key);
      const n = await countOf(k);
      await store.deleteItemAsync(`${k}.n`);
      await removeChunks(k, 0, Math.max(n, 1));
    },
  };
}
