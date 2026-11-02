// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS config plugin
const plugin = require('../../plugins/withEmulatorCleartext') as {
  emulatorHost(env: Record<string, string | undefined>): string | null;
  networkSecurityXml(host: string): string;
};

describe('emulator cleartext plugin (Q11)', () => {
  it('does nothing outside the emulator profile', () => {
    expect(plugin.emulatorHost({ EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: '192.168.1.20' })).toBeNull();
    expect(plugin.emulatorHost({ APP_VARIANT: 'preview', EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: '192.168.1.20' })).toBeNull();
  });

  it('allows cleartext to exactly one private LAN address', () => {
    expect(plugin.emulatorHost({ APP_VARIANT: 'emulator', EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: '192.168.1.20' })).toBe('192.168.1.20');
    const xml = plugin.networkSecurityXml('192.168.1.20');
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(xml).toContain('<domain includeSubdomains="false">192.168.1.20</domain>');
    expect(xml).not.toContain('example.com');
  });

  it('fails the build for public, malformed or placeholder hosts', () => {
    for (const h of ['8.8.8.8', 'SET-YOUR-PC-WIFI-IP', 'evil.example', '192.168.1.300', '']) {
      expect(() => plugin.emulatorHost({ APP_VARIANT: 'emulator', EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: h })).toThrow();
    }
  });
});
