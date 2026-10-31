import type { Provider } from './keyFormat';
import { normalizeKey } from './keyFormat';

/** Storage port for user AI keys (Keychain / Keystore in the app). */
export interface SecretStorePort {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface KeyVault {
  get(provider: Provider): Promise<string | null>;
  /** Validates the format first; throws AppError('invalid_key') on bad input. */
  set(provider: Provider, rawKey: string): Promise<void>;
  remove(provider: Provider): Promise<void>;
  has(provider: Provider): Promise<boolean>;
}

const slot = (p: Provider) => `ai.${p}.apiKey`;

export function createKeyVault(store: SecretStorePort): KeyVault {
  return {
    get: (p) => store.get(slot(p)),
    async set(p, rawKey) {
      const r = normalizeKey(p, rawKey);
      if (!r.ok) throw r.error;
      await store.set(slot(p), r.value);
    },
    remove: (p) => store.remove(slot(p)),
    has: async (p) => (await store.get(slot(p))) !== null,
  };
}
