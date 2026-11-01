/**
 * Route table check. Expo Router reports conflicting routes (e.g. two files
 * resolving to /new) only at runtime on the device, so we build the route
 * tree here from the real files in src/app.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- internal module, no public types
const { getRoutes } = require('expo-router/build/getRoutes') as {
  getRoutes(ctx: unknown, opts: Record<string, unknown>): RouteNode;
};
interface RouteNode {
  route: string;
  children: RouteNode[];
}

const APP = join(__dirname, '../../src/app');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

function routesOf(files: string[]) {
  const ctx = Object.assign(() => ({ default: () => null }), { keys: () => files, resolve: (k: string) => k, id: 'app' });
  const out: string[] = [];
  const visit = (n: RouteNode, p: string) => {
    out.push(p + n.route);
    n.children.forEach((c) => visit(c, `${p}${n.route}/`));
  };
  visit(getRoutes(ctx, { internal_stripLoadRoute: true, platform: 'android' }), '');
  return out;
}

const appFiles = () => walk(APP).filter((f) => /\.tsx?$/.test(f)).map((f) => `./${relative(APP, f)}`);

describe('app routes', () => {
  it('has the P1 screens and no test files inside src/app', () => {
    const files = appFiles();
    expect(files.some((f) => f.includes('__tests__') || f.includes('.test.'))).toBe(false);
    const routes = routesOf(files);
    for (const r of ['/(tabs)/home', '/(tabs)/subjects', '/(tabs)/me', '/onboarding/look', '/onboarding/subject', '/note/[id]', '/subject/[id]', '/inbox', '/new', '/dev/editor', '/templates', '/history/[id]', '/version/[id]', '/style/[id]', '/search', '/dev/typing', '/match', '/looks', '/font-licenses']) {
      expect(routes).toContain(r);
    }
  });

  it('builds without warnings (no conflicting routes)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    routesOf(appFiles());
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
