/** P2b screens exist as routes, and the legal copies match their pinned hashes. */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = join(__dirname, '../../src/app');
const ROOT = join(__dirname, '../..');

it('has the P2b screens', () => {
  for (const f of ['account/sign-in.tsx', 'account/sign-up.tsx', 'account/verify.tsx', 'account/reset.tsx', 'account/delete.tsx', 'sync/turn-on.tsx', 'sync/attention.tsx', 'sync/conflict.tsx', 'settings/app-lock.tsx', 'legal/[doc].tsx']) {
    expect(() => readFileSync(join(APP, f))).not.toThrow();
  }
});

it('check:legal passes, and fails when a bundled page is edited by hand', () => {
  expect(execFileSync('node', ['scripts/build-legal.mjs', '--check'], { cwd: ROOT }).toString()).toContain('Legal copies OK');
  const gen = join(ROOT, 'src/modules/legal/generated/legalDocs.ts');
  const backup = join(mkdtempSync(join(tmpdir(), 'legal-')), 'legalDocs.ts');
  copyFileSync(gen, backup);
  try {
    writeFileSync(gen, readFileSync(gen, 'utf8').replace('We never see your key', 'We sometimes see your key'));
    expect(() => execFileSync('node', ['scripts/build-legal.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' })).toThrow();
  } finally {
    copyFileSync(backup, gen);
  }
});
