/**
 * Two projects:
 *  - app: React Native code under src/ (jest-expo preset, native modules mocked)
 *  - web: the editor WebView code under editor-web/ (jsdom, no RN setup)
 */
const shared = {
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
};

/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: ['src/**/*.{ts,tsx}', 'editor-web/src/**/*.ts', '!src/app/**', '!src/**/generated/**'],
  projects: [
    {
      ...shared,
      displayName: 'app',
      preset: 'jest-expo',
      moduleNameMapper: {
        ...shared.moduleNameMapper,
        '^expo-audio$': '<rootDir>/test/mocks/expo-audio.ts',
        '^react-native-webview$': '<rootDir>/test/mocks/react-native-webview.tsx',
        // P2a's deletion module (firebase/src/deletion) must use the APP's Firebase SDK, never firebase/node_modules (one SDK instance).
        '^firebase/(app|auth|firestore|storage)$': '<rootDir>/node_modules/firebase/$1',
        // P2a's firebase/src uses NodeNext ".js" import specifiers for .ts files.
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      roots: ['<rootDir>/src', '<rootDir>/scripts'],
      modulePathIgnorePatterns: ['<rootDir>/firebase/node_modules'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@shopify/react-native-skia|ts-fsrs|docx|zod)',
      ],
    },
    {
      ...shared,
      displayName: 'web',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/editor-web'],
      transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
      transformIgnorePatterns: ['node_modules/(?!(@tiptap|prosemirror-[a-z-]+|linkifyjs|orderedmap|rope-sequence|w3c-keyname|zod)/)'],
    },
  ],
};
