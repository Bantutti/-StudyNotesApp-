import appJson from '../../../app.json';
import { EN, setStrings, t } from '@/core';

describe('app name (one place: strings.ts)', () => {
  afterEach(() => setStrings(EN));

  it('app.json "name" matches the strings table', () => {
    expect(t('app.name')).toBe('NotedPo');
    expect(appJson.expo.name).toBe(t('app.name'));
  });

  it('{app} in any string is filled from the table, so a rename is one line', () => {
    expect(t('link.openBody', { host: 'example.com' })).toBe('This opens example.com in your browser, outside NotedPo.');
    expect(t('welcome.title')).toBe('Welcome to NotedPo');
    setStrings({ ...EN, 'app.name': 'Renamed' });
    expect(t('welcome.title')).toBe('Welcome to Renamed');
  });

  it('final app id confirmed by Rey (Nov 1): same id on Android and iOS, matching scheme and slug', () => {
    expect(appJson.expo.android.package).toBe('io.github.bantutti.notedpo');
    expect(appJson.expo.ios.bundleIdentifier).toBe('io.github.bantutti.notedpo');
    expect(appJson.expo.scheme).toBe('notedpo');
    expect(appJson.expo.slug).toBe('notedpo');
  });

  it('no P0 placeholder identifiers remain in app.json', () => {
    expect(JSON.stringify(appJson)).not.toMatch(/reyanyan|studynotes|study-notes/i);
  });
});
