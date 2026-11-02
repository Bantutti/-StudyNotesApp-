/**
 * Draw mode's touch surface (decision Q1): laid exactly over the editor
 * WebView, so its touch coordinates ARE the WebView's view coordinates.
 * Shown only in Draw mode.
 *
 * Everything time-critical runs on the UI thread as worklets:
 *  - routing (input/routing.ts): pen draws; a finger draws or scrolls by the
 *    stylus-aware rules; palms near the pen are ignored (Q8);
 *  - the live stroke: smoothed with the SAME smoothStep as the committed
 *    stroke (INK_MATH §2.1) and drawn by Skia from an SVG path built by the
 *    same geometry code, so committing never moves the line;
 *  - finger scrolling and two-finger scroll/pinch are forwarded to the page.
 * The JS thread only hears about finished gestures (scheduleOnRN).
 *
 * After a stroke ends, its live copy stays on screen until the page confirms
 * it drew the committed stroke (the screen bumps `clearKey` on inkAck, or
 * after a 600 ms fallback), so there is no flicker.
 *
 * UNVERIFIED on real hardware (no device run yet): latency, palm handling,
 * Android/iOS pointer types. The Ink diagnostics screen measures these.
 */
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { routePointer, pastScrollSlop, type InkInputMode } from '../input/routing';
import { POINTER } from '../policy';
import type { InkPoint } from '../model/codec';
import { smoothStep } from '../geometry/smooth';
import { strokeOutline } from '../geometry/outline';
import { centerlinePath, polygonPath } from '../geometry/svg';

export type OverlayTool = 'pen' | 'hl' | 'eraser' | 'lasso';

export interface InkOverlayProps {
  tool: OverlayTool;
  /** Resolved colour (hex) for the live stroke. */
  colour: string;
  /** Live stroke width in px. */
  widthPx: number;
  inputMode: InkInputMode;
  fingerDraw: boolean;
  stylusSeen: boolean;
  /** Changes when the page has drawn the committed strokes: clears the live copy. */
  clearKey: number;
  /** Selection box (view px) for lasso moves, or null. */
  selectionBox: { x: number; y: number; width: number; height: number } | null;
  onStroke(points: InkPoint[]): void;
  onEraseStart(): void;
  onErase(x: number, y: number): void;
  onEraseEnd(): void;
  onLasso(points: InkPoint[]): void;
  onMoveSelection(dx: number, dy: number): void;
  onScroll(dx: number, dy: number): void;
  onFling(vx: number, vy: number): void;
  onZoom(scale: number): void;
  onStylusSeen(): void;
  /** Diagnostics counters (metadata only). */
  onPalmRejected?(): void;
}

const EMPTY = () => Skia.Path.Make();

export function InkOverlay(p: InkOverlayProps) {
  // Mirrors of props the worklets read (shared values are visible on the UI thread).
  const tool = useSharedValue<OverlayTool>(p.tool);
  const mode = useSharedValue<InkInputMode>(p.inputMode);
  const fingerDraw = useSharedValue(p.fingerDraw);
  const stylusSeen = useSharedValue(p.stylusSeen);
  const width = useSharedValue(p.widthPx);
  const sel = useSharedValue(p.selectionBox);
  const clearKey = useSharedValue(p.clearKey);
  // Prop mirrors are written ONLY here; worklets keep their own state in separate values.
  useEffect(() => {
    tool.set(p.tool);
    mode.set(p.inputMode);
    fingerDraw.set(p.fingerDraw);
    stylusSeen.set(p.stylusSeen);
    width.set(p.widthPx);
    sel.set(p.selectionBox);
    clearKey.set(p.clearKey);
  }, [p.tool, p.inputMode, p.fingerDraw, p.stylusSeen, p.widthPx, p.selectionBox, p.clearKey, tool, mode, fingerDraw, stylusSeen, width, sel, clearKey]);
  /** A stylus touched the screen during this mount (UI-thread copy, before the prop catches up). */
  const seenHere = useSharedValue(false);

  // Gesture state (UI thread).
  const route = useSharedValue<'draw' | 'scroll' | 'ignore' | 'move'>('ignore');
  const penDown = useSharedValue(false);
  const penUpAt = useSharedValue(0);
  const raw = useSharedValue<InkPoint[]>([]);
  const last = useSharedValue<InkPoint | null>(null);
  const smooth = useSharedValue<InkPoint[]>([]);
  const scrolling = useSharedValue(false);
  // Centreline paths are stroked; variable-width outlines (pen with pressure) are filled.
  const live = useSharedValue<SkPath>(EMPTY());
  const liveFill = useSharedValue<SkPath>(EMPTY());
  // The committed stroke's live copy, tagged with the clearKey it was drawn under: it shows until
  // the screen bumps clearKey (the page drew the real stroke, or the fallback timer fired).
  const pending = useSharedValue<SkPath>(EMPTY());
  const pendingFill = useSharedValue<SkPath>(EMPTY());
  const pendingKey = useSharedValue(-1);
  const pendingShown = useDerivedValue(() => (pendingKey.get() === clearKey.get() ? pending.get() : EMPTY()));
  const pendingFillShown = useDerivedValue(() => (pendingKey.get() === clearKey.get() ? pendingFill.get() : EMPTY()));
  const pinchBase = useSharedValue(1);
  const zoom = useSharedValue(1);

  const draw = usePanGesture({
    minDistance: 0,
    maxPointers: 1,
    onBegin: (e) => {
      'worklet';
      const isPen = e.pointerType === POINTER.STYLUS;
      if (isPen) {
        penDown.set(true);
        if (!stylusSeen.get() && !seenHere.get()) {
          seenHere.set(true);
          scheduleOnRN(p.onStylusSeen);
        }
      }
      const r = routePointer(e.pointerType, {
        mode: mode.get(),
        fingerDraw: fingerDraw.get(),
        stylusSeen: stylusSeen.get() || seenHere.get(),
        penDown: penDown.get() && !isPen,
        penUpAt: penUpAt.get(),
        now: Date.now(),
      });
      route.set(r);
      scrolling.set(false);
      if (r === 'ignore') {
        if (p.onPalmRejected) scheduleOnRN(p.onPalmRejected);
        return;
      }
      if (r !== 'draw') return;
      // Lasso: a drag that starts inside the current selection moves it.
      const b = sel.get();
      if (tool.get() === 'lasso' && b && e.x >= b.x && e.x <= b.x + b.width && e.y >= b.y && e.y <= b.y + b.height) {
        route.set('move');
        return;
      }
      const pt: InkPoint = isPen && e.stylusData ? { x: e.x, y: e.y, p: e.stylusData.pressure } : { x: e.x, y: e.y };
      raw.set([pt]);
      smooth.set([pt]);
      last.set(pt);
      if (tool.get() === 'eraser') scheduleOnRN(p.onEraseStart);
    },
    onUpdate: (e) => {
      'worklet';
      if (route.get() === 'scroll') {
        if (!scrolling.get() && !pastScrollSlop(e.translationX, e.translationY)) return;
        scrolling.set(true);
        scheduleOnRN(p.onScroll, -e.changeX, -e.changeY);
        return;
      }
      if (route.get() === 'move') {
        const b = sel.get();
        if (b) {
          live.set(
            Skia.PathBuilder.Make()
              .addRect({ x: b.x + e.translationX, y: b.y + e.translationY, width: b.width, height: b.height })
              .build(),
          );
        }
        return;
      }
      if (route.get() !== 'draw') return;
      const pt: InkPoint = e.stylusData && e.pointerType === POINTER.STYLUS ? { x: e.x, y: e.y, p: e.stylusData.pressure } : { x: e.x, y: e.y };
      raw.modify((a) => {
        'worklet';
        a.push(pt);
        return a;
      });
      if (tool.get() === 'eraser') {
        scheduleOnRN(p.onErase, e.x, e.y);
        live.set(Skia.PathBuilder.Make().addCircle(e.x, e.y, 10).build());
        return;
      }
      const prev = last.get() ?? pt;
      const s = smoothStep(prev, pt);
      last.set(s);
      smooth.modify((a) => {
        'worklet';
        a.push(s);
        return a;
      });
      // Live path: the same geometry as the committed stroke (centreline, or outline with pressure).
      const pts = [...smooth.get(), pt];
      if (tool.get() === 'lasso') {
        const path = Skia.Path.MakeFromSVGString(centerlinePath(raw.get()));
        if (path) live.set(path);
      } else if (pt.p !== undefined && tool.get() === 'pen') {
        const path = Skia.Path.MakeFromSVGString(polygonPath(strokeOutline(pts, width.get())));
        if (path) liveFill.set(path);
      } else {
        const path = Skia.Path.MakeFromSVGString(centerlinePath(pts));
        if (path) live.set(path);
      }
    },
    // Velocity and translation exist only here (the end of an ACTIVE gesture).
    onDeactivate: (e) => {
      'worklet';
      if (route.get() === 'scroll' && scrolling.get()) scheduleOnRN(p.onFling, -e.velocityX, -e.velocityY);
      if (route.get() === 'move') {
        live.set(EMPTY());
        if (!e.canceled) scheduleOnRN(p.onMoveSelection, e.translationX, e.translationY);
      }
    },
    onFinalize: (e) => {
      'worklet';
      if (e.pointerType === POINTER.STYLUS) {
        penDown.set(false);
        penUpAt.set(Date.now());
      }
      const r = route.get();
      route.set('ignore');
      if (r !== 'draw') return;
      const pts = raw.get().slice();
      raw.set([]);
      smooth.set([]);
      if (tool.get() === 'eraser') {
        live.set(EMPTY());
        scheduleOnRN(p.onEraseEnd);
        return;
      }
      // A cancelled gesture (e.g. a second pointer landed: often a palm) draws nothing.
      if (e.canceled) {
        live.set(EMPTY());
        liveFill.set(EMPTY());
        return;
      }
      if (tool.get() === 'lasso') {
        live.set(EMPTY());
        if (pts.length >= 3) scheduleOnRN(p.onLasso, pts);
        return;
      }
      // Pen / highlighter: keep the live copy until the page has drawn the committed stroke.
      pending.set(live.get());
      pendingFill.set(liveFill.get());
      pendingKey.set(clearKey.get());
      live.set(EMPTY());
      liveFill.set(EMPTY());
      if (pts.length) scheduleOnRN(p.onStroke, pts);
    },
  });

  // Two fingers always scroll (every mode), and pinch zooms 1x..3x (Q11).
  const twoFinger = usePanGesture({
    minPointers: 2,
    maxPointers: 2,
    onUpdate: (e) => {
      'worklet';
      scheduleOnRN(p.onScroll, -e.changeX, -e.changeY);
    },
    onDeactivate: (e) => {
      'worklet';
      scheduleOnRN(p.onFling, -e.velocityX, -e.velocityY);
    },
  });
  const pinch = usePinchGesture({
    onActivate: () => {
      'worklet';
      pinchBase.set(zoom.get());
    },
    onUpdate: (e) => {
      'worklet';
      const next = Math.min(3, Math.max(1, pinchBase.get() * e.scale));
      // Send only noticeable changes (each zoom re-lays out the page).
      if (Math.abs(next - zoom.get()) >= 0.05) {
        zoom.set(next);
        scheduleOnRN(p.onZoom, next);
      }
    },
  });
  const gesture = useSimultaneousGestures(draw, twoFinger, pinch);

  const isHl = p.tool === 'hl';
  const guide = p.tool === 'lasso' || p.tool === 'eraser';
  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false} accessibilityLabel="Drawing area" testID="ink-overlay">
        <Canvas style={StyleSheet.absoluteFill}>
          <Path path={pendingShown} color={p.colour} style="stroke" strokeWidth={p.widthPx} strokeCap="round" strokeJoin="round" opacity={isHl ? 0.45 : 1} />
          <Path path={pendingFillShown} color={p.colour} style="fill" />
          <Path
            path={live}
            color={guide ? '#7A7A7A' : p.colour}
            style="stroke"
            strokeWidth={guide ? 1.5 : p.widthPx}
            strokeCap="round"
            strokeJoin="round"
            opacity={isHl ? 0.45 : 1}
          />
          <Path path={liveFill} color={p.colour} style="fill" />
        </Canvas>
      </View>
    </GestureDetector>
  );
}
