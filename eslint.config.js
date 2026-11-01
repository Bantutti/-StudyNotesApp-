// ESLint flat config.
// Module boundary rule: code outside a feature module may only import the
// module's public index (`@/modules/<name>`), never its internals.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      'dist-check/*',
      'exports/*',
      'editor-web/dist/*',
      'src/modules/editor/generated/*',
      'src/modules/stylepacks/generated/**',
      // firebase/ is a separate npm project (P2a) with its own ESLint config and tsconfig.
      'firebase/**',
      '.expo/*',
    ],
  },
  {
    rules: {
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/*'],
              message:
                'Import a feature module only through its public index, e.g. "@/modules/export".',
            },
            {
              group: ['@/core/*', '!@/core/ui'],
              message: 'Import shared core through "@/core" (or "@/core/ui" for UI pieces).',
            },
          ],
        },
      ],
    },
  },
  {
    // The editor page (bundled into the WebView, no "@/" alias) may import shared code by relative
    // path, but only these dependency-free parts (docs/ARCHITECTURE.md, module rule 6).
    files: ['editor-web/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // The app's src/ (two levels up from editor-web/src and editor-web/__tests__), except the
              // three allowed places. "../src/..." from the tests is editor-web's own code.
              regex: '^\\.\\./\\.\\./(\\.\\./)*src/(?!(core/document(/[A-Za-z]+)?|modules/editor/protocol|modules/stylepacks/web)$)',
              message:
                'editor-web may only import src/core/document, src/modules/editor/protocol and src/modules/stylepacks/web (ARCHITECTURE.md, module rule 6).',
            },
            { group: ['@/*'], message: 'editor-web has no "@/" alias; use the allowed relative paths.' },
          ],
        },
      ],
    },
  },
  {
    // Node build scripts may print to the console.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
]);
