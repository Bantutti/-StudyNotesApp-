/**
 * Low-latency ink surface: gestures and path building run on the UI thread
 * (Reanimated worklets), Skia redraws from shared values, and React never
 * re-renders during a stroke. Skia 2.x paths are immutable, so each stroke
 * grows an SkPathBuilder and publishes build() snapshots.
 */
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { acceptPointer, POINTER, type InkMode } from './policy';
import { emptyInkStats, recordFrame, recordPressure, type InkStats } from './stats';

export interface InkCanvasHandle {
  clear(): void;
  readStats(): InkStats;
  resetStats(): void;
}

interface Props {
  mode: InkMode;
  color: string;
  paper: string;
  strokeWidth?: number;
}

export const InkCanvas = forwardRef<InkCanvasHandle, Props>(function InkCanvas(
  { mode, color, paper, strokeWidth = 3 },
  ref,
) {
  const strokeBuilder = useSharedValue(Skia.PathBuilder.Make());
  const allBuilder = useSharedValue(Skia.PathBuilder.Make());
  const committed = useSharedValue<SkPath>(Skia.Path.Make());
  const current = useSharedValue<SkPath>(Skia.Path.Make());
  const stats = useSharedValue<InkStats>(emptyInkStats());
  const stylusSeen = useSharedValue(false);
  const drawing = useSharedValue(false);
  const strokeStart = useSharedValue(0);

  const frames = useFrameCallback((info) => {
    'worklet';
    if (!drawing.value) return;
    const dt = info.timeSincePreviousFrame ?? 0;
    stats.modify((s) => {
      'worklet';
      recordFrame(s, dt);
      return s;
    });
  }, true);

  const pan = usePanGesture({
    minDistance: 0,
    maxPointers: 1,
    onBegin: (e) => {
      'worklet';
      if (e.pointerType === POINTER.STYLUS) stylusSeen.value = true;
      if (!acceptPointer(mode, e.pointerType, stylusSeen.value)) {
        stats.modify((s) => {
          'worklet';
          s.rejected += 1;
          return s;
        });
        drawing.value = false;
        return;
      }
      drawing.value = true;
      strokeStart.value = Date.now();
      strokeBuilder.value.reset();
      strokeBuilder.value.moveTo(e.x, e.y).lineTo(e.x + 0.01, e.y + 0.01);
      current.value = strokeBuilder.value.build();
      stats.modify((s) => {
        'worklet';
        s.strokes += 1;
        if (e.pointerType === POINTER.STYLUS) s.stylusStrokes += 1;
        else s.touchStrokes += 1;
        return s;
      });
    },
    onUpdate: (e) => {
      'worklet';
      if (!drawing.value) return;
      strokeBuilder.value.lineTo(e.x, e.y);
      current.value = strokeBuilder.value.build();
      const pressure = e.stylusData?.pressure ?? 0;
      stats.modify((s) => {
        'worklet';
        s.points += 1;
        recordPressure(s, pressure);
        return s;
      });
    },
    onFinalize: () => {
      'worklet';
      if (!drawing.value) return;
      drawing.value = false;
      const ms = Date.now() - strokeStart.value;
      allBuilder.value.addPath(strokeBuilder.value.detach());
      committed.value = allBuilder.value.build();
      current.value = Skia.Path.Make();
      stats.modify((s) => {
        'worklet';
        s.strokeMs += ms;
        return s;
      });
    },
  });

  useImperativeHandle(ref, () => ({
    clear() {
      allBuilder.value = Skia.PathBuilder.Make();
      committed.value = Skia.Path.Make();
      current.value = Skia.Path.Make();
    },
    readStats() {
      return JSON.parse(JSON.stringify(stats.value)) as InkStats;
    },
    resetStats() {
      stats.value = emptyInkStats();
      stylusSeen.value = false;
    },
  }));

  // Keep the frame callback referenced so it is not garbage collected.
  void frames;

  return (
    <View style={[styles.fill, { backgroundColor: paper }]}>
      <GestureDetector gesture={pan}>
        <View style={styles.fill} collapsable={false} accessibilityLabel="Drawing area">
          <Canvas style={styles.fill}>
            <Path path={committed} color={color} style="stroke" strokeWidth={strokeWidth} strokeCap="round" strokeJoin="round" />
            <Path path={current} color={color} style="stroke" strokeWidth={strokeWidth} strokeCap="round" strokeJoin="round" />
          </Canvas>
        </View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({ fill: { flex: 1 } });
