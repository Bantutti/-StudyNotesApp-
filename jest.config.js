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
        // P4b: Skia needs native JSI bindings; ink logic is tested directly, drawing on devices.
        '^@shopify/react-native-skia$': '<rootDir>/test/mocks/react-native-skia.tsx',
        // P4b: Reanimated 4 boots native worklets (even its own mock does); a small stub instead.
        '^react-native-reanimated$': '<rootDir>/test/mocks/react-native-reanimated.ts',
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
