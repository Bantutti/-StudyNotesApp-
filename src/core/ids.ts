/**
 * Random identifiers. The random source is injected so the app uses a CSPRNG
 * (expo-crypto) and tests can be deterministic.
 */
export type RandomBytes = (n: number) => Uint8Array;

const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz';

export interface IdGenerator {
  /** e.g. newId('b') -> "b_3kQ9..." */
  newId(prefix: string): string;
}

export function createIdGenerator(randomBytes: RandomBytes, length = 16): IdGenerator {
  return {
    newId(prefix) {
      const bytes = randomBytes(length);
      let s = '';
      for (let i = 0; i < length; i++) {
        s += ID_ALPHABET[(bytes[i] as number) % ID_ALPHABET.length];
      }
      return `${prefix}_${s}`;
    },
  };
}

/** Deterministic generator for tests and golden data. */
export function createSeqIdGenerator(): IdGenerator {
  let n = 0;
  return { newId: (prefix) => `${prefix}_${String(++n).padStart(16, '0')}` };
}
