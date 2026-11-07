/**
 * Exercise the actual Metro/Expo Babel output in separate simulated JS/UI
 * contexts. Native Skia and the runtime handoff are stand-ins, not a device.
 */
import { transformFileSync, transformSync } from '@babel/core';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

import { smoothStep } from '../geometry/smooth';

const root = process.cwd();
const preset = require.resolve('babel-preset-expo');
const metro = { name: 'metro', platform: 'android', isDev: true, supportsStaticESM: false };
type Worklet = ((...args: never[]) => unknown) & { __workletHash?: number; __closure?: unknown[]; __initData?: { code: string } };
type Shared = { value: unknown; get(): unknown; set(value: unknown): void; modify(fn: (value: unknown) => unknown): void };

function setup(tool = 'pen', oldFactory = false, overrides: Record<string, unknown> = {}, oldDefaults = false) {
  const shared: Shared[] = [];
  const derived: Worklet[] = [];
  const gestures: Record<string, Worklet>[] = [];
  const paths: unknown[] = [];
  const skia = {
    Path: {
      Make: () => { const path = { empty: true }; paths.push(path); return path; },
      MakeFromSVGString: (svg: string) => ({ svg }),
    },
    PathBuilder: { Make: () => ({ addRect: () => ({ build: () => ({ rect: true }) }), addCircle: () => ({ build: () => ({ circle: true }) }) }) },
  };
  const scheduled = jest.fn((fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args));
  const modules: Record<string, unknown> = {
    '@shopify/react-native-skia': { Skia: skia, Canvas: 'Canvas', Path: 'Path' },
    react: { useEffect: () => {} },
    'react-native': { StyleSheet: { absoluteFill: {} }, View: 'View' },
    'react-native-gesture-handler': {
      GestureDetector: 'GestureDetector',
      usePanGesture: (g: Record<string, Worklet>) => { gestures.push(g); return g; },
      usePinchGesture: (g: Record<string, Worklet>) => { gestures.push(g); return g; },
      useSimultaneousGestures: () => ({}),
    },
    'react-native-reanimated': {
      useSharedValue: (value: unknown) => {
        const item: Shared = { value, get() { return this.value; }, set(v) { this.value = v; }, modify(fn) { this.value = fn(this.value); } };
        shared.push(item);
        return item;
      },
      useDerivedValue: (fn: Worklet) => { derived.push(fn); return fn; },
    },
    'react-native-worklets': { scheduleOnRN: scheduled },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
  };
  const cache: Record<string, Record<string, unknown>> = {};
  // Compile the actual source and its local helper imports, not Jest's mocked modules.
  function load(file: string): Record<string, unknown> {
    const path = resolve(file);
    if (cache[path]) return cache[path];
    const exports: Record<string, unknown> = {};
    cache[path] = exports;
    const options = { configFile: false, babelrc: false, presets: [[preset]], caller: metro };
    // Recreate old call sites in memory to demonstrate the regressions without changing source.
    let output: string;
    if ((oldFactory || oldDefaults) && path.endsWith('/ui/InkOverlay.tsx')) {
      let source = readFileSync(path, 'utf8');
      if (oldFactory) source = source.replace("const EMPTY = () => {\n  'worklet';\n  return Skia.Path.Make();\n};", 'const EMPTY = () => Skia.Path.Make();');
      if (oldDefaults) source = source.replace('smoothStep(prev, pt, SMOOTHING, PRESSURE_SMOOTHING)', 'smoothStep(prev, pt)');
      output = transformSync(source, { ...options, filename: path })!.code!;
    } else {
      output = transformFileSync(path, options)!.code!;
    }
    const localRequire = (name: string): unknown => {
      if (name in modules) return modules[name];
      if (name.startsWith('.')) return load(resolve(dirname(path), `${name}.ts`));
      // Babel-emitted CommonJS imports are resolved dynamically by the test harness.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(name);
    };
    runInContext(output, createContext({ exports, require: localRequire, global }), { filename: path });
    return exports;
  }

  const callbacks = { onStroke: jest.fn(), onEraseStart: jest.fn(), onErase: jest.fn(), onEraseEnd: jest.fn(), onLasso: jest.fn(), onMoveSelection: jest.fn(), onScroll: jest.fn(), onFling: jest.fn(), onZoom: jest.fn(), onStylusSeen: jest.fn() };
  const overlay = load(join(root, 'src/modules/ink/ui/InkOverlay.tsx')).InkOverlay as (props: object) => void;
  overlay({ tool, colour: '#123456', widthPx: 3, inputMode: 'finger', fingerDraw: true, stylusSeen: false, clearKey: 0, selectionBox: null, ...callbacks, ...overrides });

  // Use the installed guard for non-worklet functions crossing the simulated
  // boundary. Worklet metadata and code come from the real Babel output.
  const guardSource = readFileSync(join(root, 'node_modules/react-native-worklets/src/memory/remoteFunctionUnpacker.native.ts'), 'utf8')
    .replace('export function installRemoteFunctionUnpacker', 'function installRemoteFunctionUnpacker');
  const guardCode = transformSync(guardSource, { filename: 'guard.ts', configFile: false, babelrc: false, plugins: [require.resolve('@babel/plugin-transform-typescript')] })!.code!.replace(/^export \{\};?$/m, '');
  const ui = createContext({ __RUNTIME_NAME: 'UI', global });
  runInContext(`${guardCode}\ninstallRemoteFunctionUnpacker();`, ui);
  const guard = ui.__remoteFunctionUnpacker as (name: string) => Worklet;
  function onUI(fn: Worklet): Worklet {
    if (fn === scheduled) return fn;
    if (typeof fn.__workletHash !== 'number' || !fn.__initData) return guard(fn.name);
    const reconstructed = runInContext(fn.__initData.code, ui) as Worklet;
    const closure = (fn.__closure ?? []).map((value) => typeof value === 'function' ? onUI(value as Worklet) : value);
    return reconstructed.bind({ __closure: closure }) as Worklet;
  }
  return { shared, derived, gestures, paths, callbacks, onUI };
}

it('reproduces the prior synchronous remote-function error in a derived callback', () => {
  const { derived, onUI } = setup('pen', true);
  expect(() => onUI(derived[0]!)()).toThrow(/synchronously call a Remote Function/);
});

it('reproduces the captured-default error in the old smoothing call on the UI runtime', () => {
  const { gestures, onUI } = setup('pen', false, {}, true);
  const draw = gestures[0]!;
  const point = { x: 1, y: 2, pointerType: 0, translationX: 1, translationY: 2, changeX: 1, changeY: 1 };
  onUI(draw.onBegin!)(point as never);
  expect(() => onUI(draw.onUpdate!)(point as never)).toThrow(/SMOOTHING is not defined/);
});

it('workletizes the empty factory and runs both real derived callbacks across a simulated UI boundary', () => {
  const { derived, paths, onUI } = setup();
  expect(derived).toHaveLength(2);
  for (const value of derived) {
    const factory = value.__closure?.find((item) => typeof item === 'function') as Worklet;
    expect(factory.__workletHash).toEqual(expect.any(Number));
    expect(factory.__initData?.code).toContain('Skia.Path.Make()');
    expect(onUI(value)()).toEqual({ empty: true });
  }
  expect(paths).toHaveLength(6); // Four initial paths and one per derived value.
});

it.each(['pen', 'hl', 'lasso', 'eraser'])('runs %s gesture helper calls on the simulated UI runtime', (tool) => {
  const { gestures, callbacks, onUI } = setup(tool);
  const draw = gestures[0]!;
  const point = (x: number, y: number) => ({ x, y, pointerType: 1, stylusData: { pressure: 0.7 }, translationX: x, translationY: y, changeX: 1, changeY: 1 });
  onUI(draw.onBegin!)(point(1, 2) as never);
  onUI(draw.onUpdate!)(point(3, 4) as never);
  onUI(draw.onUpdate!)(point(5, 6) as never);
  onUI(draw.onFinalize!)({ pointerType: 1, canceled: false } as never);
  if (tool === 'lasso') expect(callbacks.onLasso).toHaveBeenCalledTimes(1);
  else if (tool === 'eraser') expect(callbacks.onEraseEnd).toHaveBeenCalledTimes(1);
  else expect(callbacks.onStroke).toHaveBeenCalledTimes(1);
});

it('uses the same default smoothing and pressure values as the JS implementation', () => {
  const { shared, gestures, onUI } = setup();
  const draw = gestures[0]!;
  const event = (x: number, y: number, pressure: number) => ({ x, y, pointerType: 1, stylusData: { pressure } });
  onUI(draw.onBegin!)(event(1, 2, 0.2) as never);
  onUI(draw.onUpdate!)(event(5, 8, 0.8) as never);
  const smoothed = shared[13]!.get() as { x: number; y: number; p?: number }[];
  expect(smoothed[1]).toEqual(smoothStep({ x: 1, y: 2, p: 0.2 }, { x: 5, y: 8, p: 0.8 }));
});

it('keeps a completed live path until acknowledgement and discards a cancelled stroke', () => {
  const { shared, derived, gestures, callbacks, onUI } = setup('hl');
  const draw = gestures[0]!;
  const point = (x: number) => ({ x, y: x, pointerType: 0, translationX: x, translationY: x, changeX: 1, changeY: 1 });
  onUI(draw.onBegin!)(point(1) as never);
  onUI(draw.onUpdate!)(point(3) as never);
  onUI(draw.onFinalize!)({ pointerType: 0, canceled: false } as never);
  expect(callbacks.onStroke).toHaveBeenCalledTimes(1);
  expect(onUI(derived[0]!)()).toEqual(shared[17]!.get()); // pending path
  shared[6]!.set(1); // clearKey acknowledgement
  expect(onUI(derived[0]!)()).toEqual({ empty: true });
  onUI(draw.onBegin!)(point(4) as never);
  onUI(draw.onUpdate!)(point(5) as never);
  onUI(draw.onFinalize!)({ pointerType: 0, canceled: true } as never);
  expect(callbacks.onStroke).toHaveBeenCalledTimes(1);
  expect(shared[15]!.get()).toEqual({ empty: true }); // live stroke reset
  expect(shared[16]!.get()).toEqual({ empty: true }); // live fill reset
});

it('clears a selection-move guide on deactivate and does not commit a cancelled move', () => {
  const { shared, gestures, callbacks, onUI } = setup('lasso', false, { selectionBox: { x: 0, y: 0, width: 10, height: 10 } });
  const draw = gestures[0]!;
  onUI(draw.onBegin!)({ x: 1, y: 1, pointerType: 0 } as never);
  onUI(draw.onUpdate!)({ translationX: 2, translationY: 3 } as never);
  expect(shared[15]!.get()).toEqual({ rect: true });
  onUI(draw.onDeactivate!)({ translationX: 2, translationY: 3, canceled: true } as never);
  onUI(draw.onFinalize!)({ pointerType: 0, canceled: true } as never);
  expect(shared[15]!.get()).toEqual({ empty: true });
  expect(callbacks.onMoveSelection).not.toHaveBeenCalled();
});
