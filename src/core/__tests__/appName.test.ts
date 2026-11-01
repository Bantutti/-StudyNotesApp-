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

  it('the package id and bundle identifier are NOT changed yet (TODO: io.github.bantutti.notedpo, pending Rey)', () => {
    expect(appJson.expo.android.package).toBe('com.reyanyan.studynotes.dev');
    expect(appJson.expo.ios.bundleIdentifier).toBe('com.reyanyan.studynotes.dev');
  });
});
