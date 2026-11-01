/**
 * Emulator end-to-end tests (P2b): the real Firebase JS SDK against the
 * local emulators (project demo-studynotes). Not part of `npm test`.
 * Run with `npm run test:sync-e2e` (starts and stops the emulators; needs
 * Java 21+, like `cd firebase && npm test`).
 *
 * jest-expo mocks the native modules @/core imports; the test environment
 * is plain Node with Node export conditions, so `firebase` loads its Node
 * build (fetch, no React Native shims) and tests can use node:sqlite.
 */
const base = require('./jest.config.js').projects[0];

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  displayName: 'e2e',
  testEnvironment: '<rootDir>/test/e2e/environment.js',
  setupFilesAfterEnv: ['<rootDir>/test/e2e/setup.js'],
  testEnvironmentOptions: { customExportConditions: ['node', 'require', 'default'] },
  testMatch: ['**/__e2e__/**/*.e2e.test.ts'],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // One Firebase SDK instance: P2a's deletion module resolves to the app's copy.
    '^firebase/(app|auth|firestore|storage)$': '<rootDir>/node_modules/firebase/$1',
  },
  roots: ['<rootDir>/src'],
  testTimeout: 60_000,
  maxWorkers: 1,
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@shopify/react-native-skia|ts-fsrs|zod|firebase|@firebase/.*)',
  ],
};
