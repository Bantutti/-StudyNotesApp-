import { readCloudConfig } from '../config';

describe('readCloudConfig', () => {
  it('is off when nothing is configured', () => {
    expect(readCloudConfig({})).toBeNull();
  });

  it('accepts the emulator setup with a demo project and default ports', () => {
    expect(readCloudConfig({ EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-studynotes', EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: '192.168.1.20' })).toEqual({
      projectId: 'demo-studynotes',
      apiKey: 'demo-api-key',
      storageBucket: 'demo-studynotes.appspot.com',
      emulator: { host: '192.168.1.20', authPort: 9099, firestorePort: 8080, storagePort: 9199 },
    });
  });

  it('refuses emulators with a real project id (traffic must never go to a LAN box)', () => {
    expect(readCloudConfig({ EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'notedpo-prod', EXPO_PUBLIC_FIREBASE_API_KEY: 'k', EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: '10.0.0.2' })).toBeNull();
  });

  it('refuses a demo project without emulators (there is no backend behind it)', () => {
    expect(readCloudConfig({ EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-studynotes' })).toBeNull();
  });

  it('accepts a real project without emulators', () => {
    expect(readCloudConfig({ EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'notedpo-prod', EXPO_PUBLIC_FIREBASE_API_KEY: 'AIza-public' })).toMatchObject({
      projectId: 'notedpo-prod',
      emulator: null,
    });
  });

  it('rejects junk hosts and ports', () => {
    expect(readCloudConfig({ EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-x1', EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: 'http://evil/' })).toBeNull();
    expect(readCloudConfig({ EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-x1', EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: 'localhost', EXPO_PUBLIC_FIREBASE_FIRESTORE_PORT: '99999' })).toBeNull();
  });
});
