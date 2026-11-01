/**
 * React Native pieces of the Firebase setup.
 *
 * getReactNativePersistence exists only in Firebase Auth's React Native
 * build (Metro picks it through the "react-native" export condition); the
 * public TypeScript types don't declare it, so it is read defensively.
 * It is given the SecureStore-backed key-value store (decision Q8). If it is
 * missing (e.g. Node tests), sessions stay in memory: signed out on restart,
 * never written to a plain file.
 */
import * as FirebaseAuth from 'firebase/auth';
import type { Persistence } from 'firebase/auth';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function reactNativePersistence(storage: KeyValueStorage): Persistence | undefined {
  const make = (FirebaseAuth as unknown as { getReactNativePersistence?: (s: KeyValueStorage) => Persistence }).getReactNativePersistence;
  return typeof make === 'function' ? make(storage) : undefined;
}
