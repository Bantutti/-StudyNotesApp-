#!/usr/bin/env node
/**
 * Starts the Firebase emulators so a PHONE on the same private Wi-Fi can
 * reach them (P2b device testing). Same rules and project as `cd firebase
 * && npm run emulators`, but Auth, Firestore and Storage listen on all
 * network interfaces instead of 127.0.0.1. The emulator UI stays local.
 *
 * Only on a private home Wi-Fi, with Java allowed through Windows Firewall
 * for PRIVATE networks only (TESTING_ON_DEVICE.md, section 6). Never on
 * public Wi-Fi: anyone on the network could read the test data.
 */
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fb = join(dirname(fileURLToPath(import.meta.url)), '..', 'firebase');
const cfg = JSON.parse(readFileSync(join(fb, 'firebase.json'), 'utf8'));
for (const k of ['auth', 'firestore', 'storage']) cfg.emulators[k].host = '0.0.0.0';
const tmp = join(fb, 'firebase.lan.generated.json');
writeFileSync(tmp, JSON.stringify(cfg, null, 2));
const cleanup = () => rmSync(tmp, { force: true });
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
console.log('Emulators for your phone: use your PC\u2019s Wi-Fi address (ipconfig) in .env as EXPO_PUBLIC_FIREBASE_EMULATOR_HOST.');
const child = spawn('npx', ['firebase', 'emulators:start', '--project', 'demo-studynotes', '--config', 'firebase.lan.generated.json'], {
  cwd: fb,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));
