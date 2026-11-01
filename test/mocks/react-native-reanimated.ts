/**
 * Jest stand-in for react-native-reanimated 4 (P4b). The real library (and
 * its shipped mock) boots react-native-worklets, which needs native JSI. The
 * ink module only uses a few hooks; this stub gives them plain JS behaviour
 * so modules can be imported and simple render tests can run. Worklet timing
 * and UI-thread behaviour are checked on devices (Ink diagnostics screen).
 */
type Shared<T> = { value: T; get(): T; set(v: T | ((prev: T) => T)): void; modify(fn: (v: T) => T): void };

export function makeMutable<T>(initial: T): Shared<T> {
  const s = {
    value: initial,
    get: () => s.value,
    set: (v: T | ((prev: T) => T)) => {
      s.value = typeof v === 'function' ? (v as (prev: T) => T)(s.value) : v;
    },
    modify: (fn: (v: T) => T) => {
      s.value = fn(s.value);
    },
  };
  return s;
}

export const useSharedValue = <T>(initial: T): Shared<T> => makeMutable(initial);
export const useFrameCallback = () => ({ setActive: () => undefined, isActive: false, callbackId: 0 });
export const useDerivedValue = <T>(fn: () => T): Shared<T> => makeMutable(fn());
export const useAnimatedReaction = () => undefined;
export const runOnJS = <A extends unknown[], R>(fn: (...a: A) => R) => fn;
export const runOnUI = <A extends unknown[], R>(fn: (...a: A) => R) => fn;
export const cancelAnimation = () => undefined;
export const withTiming = <T>(v: T) => v;
export const withDecay = () => 0;

// Read by react-native-gesture-handler's Reanimated integration when it loads.
export const isSharedValue = (v: unknown): boolean => typeof v === 'object' && v !== null && 'value' in v && 'modify' in v;
export const useEvent = () => () => undefined;
export const useHandler = () => ({ doDependenciesDiffer: false, context: {} });
export const useComposedEventHandler = () => undefined;
export const setGestureState = () => undefined;
const createAnimatedComponent = <C>(component: C): C => component;

export default { makeMutable, createAnimatedComponent };
