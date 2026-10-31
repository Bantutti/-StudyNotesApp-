/**
 * Rules for what may go into a phase export zip (CommonJS so both the
 * export script and Jest can load it).
 *
 * Two independent layers:
 *  1. Path rules: build output, dependencies and secret-bearing file types
 *     are never included.
 *  2. Content scan: every included text file is checked for secret shapes;
 *     any hit aborts the export.
 */
'use strict';

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.expo', 'dist', 'dist-check', 'exports', 'android', 'ios',
  'coverage', 'web-build', '.idea', '.vscode', '.gradle', 'build',
]);

const EXCLUDED_FILES = [
  /^\.env$/i,
  /^\.env\.(?!example$).+/i,
  /\.(keystore|jks|p8|p12|pfx|pem|key|mobileprovision|apk|aab|ipa|log)$/i,
  /^google-services\.json$/i,
  /^GoogleService-Info\.plist$/i,
  /^service-account.*\.json$/i,
  /-firebase-adminsdk-.*\.json$/i,
  /^credentials\.json$/i,
  /^\.DS_Store$/,
  /^Thumbs\.db$/i,
  /^expo-env\.d\.ts$/,
];

const SECRET_PATTERNS = [
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Groq API key', re: /gsk_[A-Za-z0-9]{40,}/ },
  { name: 'Google/Firebase API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'service account JSON', re: /"type"\s*:\s*"service_account"/ },
  { name: 'private_key field', re: /"private_key"\s*:\s*"-----BEGIN/ },
  { name: 'OpenAI-style key', re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Expo access token', re: /\bEXPO_TOKEN\s*=\s*\S{20,}/ },
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ttf|otf|woff2?|ico|zip|m4a|mp3|wav|pdf|docx)$/i;

/** posix-style relative path -> include? */
function isIncluded(relPath) {
  const parts = relPath.split('/');
  if (parts.some((p) => EXCLUDED_DIRS.has(p))) return false;
  const base = parts[parts.length - 1] || '';
  if (relPath === 'editor-web/dist' || relPath.startsWith('editor-web/dist/')) return false;
  return !EXCLUDED_FILES.some((re) => re.test(base));
}

/** Returns the names of secret patterns found in a text file's content. */
function findSecrets(relPath, content) {
  if (BINARY_EXT.test(relPath)) return [];
  return SECRET_PATTERNS.filter((p) => p.re.test(content)).map((p) => p.name);
}

module.exports = { isIncluded, findSecrets, EXCLUDED_DIRS, EXCLUDED_FILES, SECRET_PATTERNS, BINARY_EXT };
