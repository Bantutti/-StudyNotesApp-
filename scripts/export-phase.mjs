#!/usr/bin/env node
/**
 * Phase export (rules section 5).
 *   node scripts/export-phase.mjs P0 prototype [--date 20261101] [--rev r2]
 *
 * Produces in exports/ (gitignored):
 *   StudyNotesApp-<phase>-<name>-<YYYYMMDD>[-r<N>].zip   (--rev for a re-export after review fixes)
 *   ...zip.sha256          checksum sidecar (a zip cannot contain its own hash)
 *   ...contents.txt        every file in the zip with its size
 *   PHASE_REPORT-<phase>.md  copy of the phase report with the checksum filled in (for Drive)
 *
 * The zip root holds the project (src, docs, config...) plus copies of
 * PHASE_REPORT.md and TESTING_ON_DEVICE.md. Entry dates are fixed to the
 * phase date so the same tree always gives the same checksum.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

import rules from './lib/exportRules.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flag = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const dateArg = flag('--date');
const revArg = flag('--rev');
const [phase, name] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--date', '--rev'].includes(all[i - 1] ?? ''));

if (!phase || !/^P\d+[a-z]?$/.test(phase) || !name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Usage: node scripts/export-phase.mjs <P0|P1|P4b...> <kebab-name> [--date YYYYMMDD]');
  process.exit(2);
}

// Project timezone is Asia/Manila (the developer's local date).
const ymd =
  dateArg ??
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())
    .replaceAll('-', '');
if (!/^\d{8}$/.test(ymd)) {
  console.error('Bad --date, expected YYYYMMDD');
  process.exit(2);
}
if (revArg !== null && !/^r[2-9]\d?$/.test(revArg)) {
  console.error('Bad --rev, expected r2, r3, ...');
  process.exit(2);
}
const zipBase = `StudyNotesApp-${phase}-${name}-${ymd}${revArg ? `-${revArg}` : ''}`;
const reportPath = join(root, 'docs', 'phases', phase, 'PHASE_REPORT.md');
const testingPath = join(root, 'docs', 'TESTING_ON_DEVICE.md');
for (const p of [reportPath, testingPath]) {
  if (!existsSync(p)) {
    console.error(`Missing ${relative(root, p)}; write the docs before exporting.`);
    process.exit(1);
  }
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (!rules.isIncluded(rel)) continue;
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const files = walk(root).sort();
const problems = [];
for (const rel of files) {
  const hits = rules.findSecrets(rel, readFileSync(join(root, rel), 'utf8'));
  if (hits.length) problems.push(`${rel}: ${hits.join(', ')}`);
}
if (problems.length) {
  console.error('Export aborted: possible secrets found:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const fixedDate = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12, 0, 0));
const zip = new JSZip();
const listing = [];
const add = (zipPath, data) => {
  zip.file(zipPath, data, { date: fixedDate, createFolders: false });
  listing.push(`${String(data.length).padStart(10)}  ${zipPath}`);
};
for (const rel of files) add(rel, readFileSync(join(root, rel)));
add('PHASE_REPORT.md', readFileSync(reportPath));
add('TESTING_ON_DEVICE.md', readFileSync(testingPath));

const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' });
const sha = createHash('sha256').update(buf).digest('hex');

const outDir = join(root, 'exports');
mkdirSync(outDir, { recursive: true });
const zipPath = join(outDir, `${zipBase}.zip`);
writeFileSync(zipPath, buf);
writeFileSync(join(outDir, `${zipBase}.zip.sha256`), `${sha}  ${zipBase}.zip\n`);
writeFileSync(join(outDir, `${zipBase}.contents.txt`), listing.sort((a, b) => a.slice(12).localeCompare(b.slice(12))).join('\n') + '\n');

const report = readFileSync(reportPath, 'utf8')
  .replaceAll('{{ZIP_NAME}}', `${zipBase}.zip`)
  .replaceAll('{{ZIP_SHA256}}', sha)
  .replaceAll('{{ZIP_BYTES}}', String(buf.length))
  .replaceAll('{{ZIP_FILES}}', String(listing.length));
writeFileSync(join(outDir, `PHASE_REPORT-${phase}.md`), report);

console.log(`Wrote ${relative(root, zipPath)} (${listing.length} files, ${(buf.length / 1024).toFixed(0)} KB)`);
console.log(`SHA-256 ${sha}`);
console.log(`Report with checksum: exports/PHASE_REPORT-${phase}.md`);
console.log(`Largest entries:\n${[...listing].sort((a, b) => parseInt(b) - parseInt(a)).slice(0, 5).join('\n')}`);
