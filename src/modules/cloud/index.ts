/**
 * cloud: the Firebase JS SDK behind small interfaces (P2b). The app talks to
 * Firebase only through this module (and P2a's deletion module, wired by
 * auth). See docs/modules/cloud.md.
 */
export { readCloudConfig, buildEnv, cloudConfigSchema, type CloudConfig, type CloudEnv } from './config';
export { createCloudServices, type CloudServices, type CreateCloudOptions } from './firebaseApp';
export { createFirestoreRemote, toRemoteError, toSdkValue } from './firestoreRemote';
export { createStorageBlobs } from './storageBlobs';
