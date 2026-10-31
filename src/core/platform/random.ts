import * as Crypto from 'expo-crypto';

import type { RandomBytes } from '../ids';

/** CSPRNG-backed random bytes (Keychain/Keystore-grade randomness). */
export const secureRandomBytes: RandomBytes = (n) => Crypto.getRandomBytes(n);
