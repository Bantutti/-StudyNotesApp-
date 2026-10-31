/**
 * Palm rejection policy (runs on the UI thread as a worklet).
 *  - any:    every pointer draws
 *  - auto:   once a stylus has been seen, finger/palm touches stop drawing
 *  - stylus: only stylus pointers draw
 * PointerType values mirror react-native-gesture-handler: TOUCH=0, STYLUS=1, MOUSE=2.
 */
export type InkMode = 'any' | 'auto' | 'stylus';

export const POINTER = { TOUCH: 0, STYLUS: 1, MOUSE: 2 } as const;

export function acceptPointer(mode: InkMode, pointerType: number, stylusSeen: boolean): boolean {
  'worklet';
  if (pointerType === POINTER.STYLUS || pointerType === POINTER.MOUSE) return true;
  if (mode === 'stylus') return false;
  if (mode === 'auto' && stylusSeen) return false;
  return true;
}
