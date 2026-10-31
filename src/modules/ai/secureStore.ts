import * as SecureStore from 'expo-secure-store';

import type { SecretStorePort } from './keyVault';

/**
 * Keychain (iOS) / Keystore-backed (Android) storage.
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY: readable only while the phone is unlocked,
 * and never included in iCloud/device-transfer backups.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const expoSecretStore: SecretStorePort = {
  get: (name) => SecureStore.getItemAsync(name, OPTIONS),
  set: (name, value) => SecureStore.setItemAsync(name, value, OPTIONS),
  remove: (name) => SecureStore.deleteItemAsync(name, OPTIONS),
};
