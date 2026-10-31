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
    // Node build scripts may print to the console.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
]);
