#!/usr/bin/env node
/**
 * Runs the P2b emulator end-to-end tests: starts the Firebase emulators
 * (project demo-studynotes, from firebase/), runs jest -c jest.e2e.config.js,
 * stops the emulators. Needs `cd firebase && npm ci` once and Java 21+.
 * Works the same on Windows (PowerShell) and Linux.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fb = join(root, 'firebase');
if (!existsSync(join(fb, 'node_modules', 'firebase-tools'))) {
  console.error('Run "cd firebase && npm ci" first (installs the emulators).');
  process.exit(1);
}
const extra = process.argv.slice(2).map((a) => JSON.stringify(a)).join(' ');
const inner = `node ${JSON.stringify(join(root, 'node_modules', 'jest', 'bin', 'jest.js'))} -c ${JSON.stringify(join(root, 'jest.e2e.config.js'))} --ci ${extra}`;
const firebaseCli = join(fb, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
if (!existsSync(firebaseCli)) {
  console.error('Run "cd firebase && npm ci" first (installs the emulators).');
  process.exit(1);
}
const r = spawnSync(process.execPath, [firebaseCli, 'emulators:exec', '--project', 'demo-studynotes', '--only', 'auth,firestore,storage', '--', inner], {
  cwd: fb,
  stdio: 'inherit',
});
process.exit(r.status ?? 1);

