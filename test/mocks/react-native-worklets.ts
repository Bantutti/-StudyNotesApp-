/** Jest stand-in for react-native-worklets (P4b): UI-thread calls run inline on the test thread. */
export const scheduleOnRN = <A extends unknown[]>(fn: (...a: A) => unknown, ...args: A): void => {
  fn(...args);
};
export const scheduleOnUI = scheduleOnRN;
export const runOnJS = <A extends unknown[], R>(fn: (...a: A) => R) => fn;
export const runOnUI = runOnJS;
