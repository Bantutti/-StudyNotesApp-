/**
 * The cloud part of the composition root (P2b). Built only when this build
 * has a valid Firebase config (EXPO_PUBLIC_FIREBASE_*; P2b: the emulator,
 * project demo-studynotes). Without one, Services.cloud is null and the app
 * is exactly the local-only P1 app.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { secureRandomBytes, type IdGenerator, type Logger } from '@/core';
import {
  createAuthService,
  createSecureKeyValue,
  unavailableApple,
  unavailableGoogle,
  type AppleTokenSource,
  type AuthService,
  type CryptoPort,
  type GoogleTokenSource,
} from '@/modules/auth';
import {
  buildEnv,
  createCloudServices,
  createFirestoreRemote,
  createStorageBlobs,
  reactNativePersistence,
  readCloudConfig,
  type CloudConfig,
  type CloudServices,
} from '@/modules/cloud';
import { defaultAssetMergers, type FileStorePort } from '@/modules/sync';

import { createSyncController, type SyncController } from './syncController';

export interface CloudRuntime {
  config: CloudConfig;
  firebase: CloudServices;
  auth: AuthService;
  sync: SyncController;
}

export interface CloudParts {
  config: CloudConfig;
  firebase: CloudServices;
  crypto: CryptoPort;
  files?: FileStorePort;
  google?: GoogleTokenSource;
  apple?: AppleTokenSource;
}

export function createCloudRuntime(parts: CloudParts, deps: { logger: Logger; ids: IdGenerator }): CloudRuntime {
  const auth = createAuthService({
    auth: parts.firebase.auth,
    google: parts.google ?? unavailableGoogle,
    apple: parts.apple ?? unavailableApple,
    crypto: parts.crypto,
    logger: deps.logger,
  });
  const sync = createSyncController({
    auth,
    remote: createFirestoreRemote(parts.firebase.firestore),
    blobs: createStorageBlobs(parts.firebase.storage),
    ...(parts.files ? { files: parts.files } : {}),
    mergers: defaultAssetMergers(), // P4b registers its ink merger here (registerAssetMerger)
    ids: deps.ids,
    logger: deps.logger,
  });
  return { config: parts.config, firebase: parts.firebase, auth, sync };
}

/** Synced files live here (app-private; wiped by Delete all data). Fixed name, never user input. */
export const SYNC_FILES_FOLDER = 'sync-files';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const expoCrypto: CryptoPort = {
  randomHex: (n) => Array.from(secureRandomBytes(n), (b) => b.toString(16).padStart(2, '0')).join(''),
  sha256Hex: (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, { encoding: Crypto.CryptoEncoding.HEX }),
};

export const expoSyncFiles: FileStorePort = {
  async read(localPath) {
    const f = new File(localPath);
    return f.exists ? new Uint8Array(await f.bytes()) : null;
  },
  async write(localPath, bytes) {
    const f = new File(localPath);
    if (!f.parentDirectory.exists) f.parentDirectory.create({ intermediates: true, idempotent: true });
    await f.write(bytes);
  },
  async remove(localPath) {
    const f = new File(localPath);
    if (f.exists) f.delete();
  },
  pathFor({ id, ext }) {
    // id and ext were validated (entity id pattern, allowed extension list) before this is called.
    return new File(new Directory(Paths.document, SYNC_FILES_FOLDER), `${id}.${ext}`).uri;
  },
};

/** The device setup: null when this build has no (valid) Firebase config. */
export function deviceCloudParts(logger: Logger): CloudParts | null {
  const config = readCloudConfig(buildEnv());
  if (!config) {
    logger.info('cloud.off');
    return null;
  }
  const storage = createSecureKeyValue({
    getItemAsync: (k) => SecureStore.getItemAsync(k, SECURE_OPTIONS),
    setItemAsync: (k, v) => SecureStore.setItemAsync(k, v, SECURE_OPTIONS),
    deleteItemAsync: (k) => SecureStore.deleteItemAsync(k, SECURE_OPTIONS),
  });
  const persistence = reactNativePersistence(storage);
  if (!persistence) logger.warn('cloud.session_memory_only');
  const firebase = createCloudServices(config, persistence ? { persistence } : {});
  logger.info('cloud.on', { emulator: config.emulator !== null });
  return { config, firebase, crypto: expoCrypto, files: expoSyncFiles };
}
