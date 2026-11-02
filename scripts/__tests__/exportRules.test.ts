// eslint-disable-next-line @typescript-eslint/no-require-imports
const rules = require('../lib/exportRules.js') as {
  isIncluded(p: string): boolean;
  findSecrets(p: string, c: string): string[];
};

describe('export path rules', () => {
  it.each([
    'src/app/index.tsx',
    'docs/SECURITY.md',
    '.env.example',
    'package-lock.json',
    'src/modules/stylepacks/packs/pastel-highlight.json',
  ])('includes %s', (p) => expect(rules.isIncluded(p)).toBe(true));

  it.each([
    'node_modules/zod/index.js',
    '.env',
    '.env.local',
    '.env.production',
    'android/app/build.gradle',
    'exports/old.zip',
    'dist-check/metadata.json',
    'release.keystore',
    'upload-key.jks',
    'AuthKey_ABC.p8',
    'certs/server.pem',
    'google-services.json',
    'GoogleService-Info.plist',
    'service-account-prod.json',
    'study-notes-firebase-adminsdk-x1.json',
    'app-release.apk',
    '.git/config',
    'editor-web/dist/bundle.js',
  ])('excludes %s', (p) => expect(rules.isIncluded(p)).toBe(false));
});

describe('export content scan', () => {
  // Secret-shaped inputs are assembled at runtime so this file never trips the scanners itself.
  const groq = 'gsk_' + 'Q'.repeat(52);
  const pemHeader = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  const serviceAccount = `{"type": "${['service', 'account'].join('_')}"}`;
  it('flags secret shapes in text files', () => {
    expect(rules.findSecrets('a.ts', `const k = "${groq}"`)).toEqual(['Groq API key']);
    expect(rules.findSecrets('a.json', serviceAccount)).toContain('service account JSON');
    expect(rules.findSecrets('a.txt', pemHeader)).toContain('private key block');
    expect(rules.findSecrets('a.ts', 'AIza' + 'b'.repeat(35))).toContain('Google/Firebase API key');
  });
  it('does not flag placeholders, masked keys or binaries', () => {
    expect(rules.findSecrets('a.ts', 'placeholder="gsk_…" pattern: /^gsk_[A-Za-z0-9]{20,100}$/')).toEqual([]);
    expect(rules.findSecrets('font.ttf', groq)).toEqual([]);
  });
});

describe('every source file is exported (P5 gate finding)', () => {
  // A folder named like build output (for example "build") inside src/ was silently dropped from the
  // phase zip once (src/modules/lookmatch/build, renamed to pack). Every tracked source file must pass.
  it('includes every file under src/, editor-web/src and scripts/', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join, relative } = require('node:path') as typeof import('node:path');
    const root = join(__dirname, '..', '..');
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [relative(root, join(d, f)).split('\\').join('/')]));
    const files = ['src', 'editor-web/src', 'scripts'].flatMap((d) => walk(join(root, d)));
    expect(files.length).toBeGreaterThan(300);
    expect(files.filter((f) => !rules.isIncluded(f))).toEqual([]);
  });
});
