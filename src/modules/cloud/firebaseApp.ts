/**
 * Creates one Firebase app instance (Auth, Firestore, Storage) from a
 * validated CloudConfig, wired to the emulators when the config says so.
 *
 * - Firestore uses the MEMORY cache: the device's real copy is SQLite, so
 *   there is no second on-disk copy of notes in IndexedDB-like storage, and
 *   nothing is replayed from a stale cache after a restart.
 * - Long polling is forced on React Native (WebChannel streaming is not
 *   reliable there); tests on Node can turn it off.
 * - Auth persistence is injected: SecureStore on devices (Q8), memory in
 *   tests. The ID token never lands in a plain file.
 * - Several named instances can exist side by side (two simulated devices
 *   in the emulator tests).
 */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, inMemoryPersistence, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

import type { CloudConfig } from './config';

export interface CloudServices {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
  config: CloudConfig;
  close(): Promise<void>;
}

export interface CreateCloudOptions {
  /** Instance name (default "[DEFAULT]"); tests use one per simulated device. */
  name?: string;
  persistence?: Persistence;
  forceLongPolling?: boolean;
}

export function createCloudServices(config: CloudConfig, opts: CreateCloudOptions = {}): CloudServices {
  const app = initializeApp(
    {
      projectId: config.projectId,
      apiKey: config.apiKey,
      ...(config.appId ? { appId: config.appId } : {}),
      ...(config.authDomain ? { authDomain: config.authDomain } : {}),
      ...(config.storageBucket ? { storageBucket: config.storageBucket } : {}),
    },
    opts.name,
  );
  const auth = initializeAuth(app, { persistence: opts.persistence ?? inMemoryPersistence });
  const firestore = initializeFirestore(app, {
    localCache: memoryLocalCache(),
    experimentalForceLongPolling: opts.forceLongPolling ?? true,
  });
  const storage = getStorage(app);
  if (config.emulator) {
    const { host, authPort, firestorePort, storagePort } = config.emulator;
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(firestore, host, firestorePort);
    connectStorageEmulator(storage, host, storagePort);
  }
  return { app, auth, firestore, storage, config, close: () => deleteApp(app) };
}
