/**
 * The Draw-mode toolbar (plan 9.4 / 9.7):
 *  - phones: a bar at the bottom, replacing the keyboard toolbar;
 *  - tablets: a floating vertical pill that docks to the left or right
 *    edge (left- or right-handed), draggable by its handle; when released
 *    it snaps to the nearer edge and remembers that side (onSide).
 * Buttons: three pack pens, highlighter, eraser (tap again: whole strokes /
 * partial), lasso, width, undo, redo, more (⋯) and Done. With a lasso
 * selection, Delete, Recolour and Clear appear.
 * Every control has an accessibility label; colour is never the only cue
 * (pens are also numbered for screen readers).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { IconButton, useTheme, type IconName } from '@/core/ui';

import type { InkToolState } from '../controller';
import { INK_STRINGS as S } from './strings';

export interface InkToolbarProps {
  variant: 'bar' | 'floating';
  side: 'left' | 'right';
  tools: InkToolState;
  /** The pack's pen colours (hex) and highlighter colour, for the swatches. */
  pens: readonly [string, string, string];
  highlighter: string;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  onTools(patch: Partial<InkToolState>): void;
  onUndo(): void;
  onRedo(): void;
  onMore(): void;
  onDone(): void;
  onDeleteSelection(): void;
  onRecolourSelection(): void;
  onClearSelection(): void;
  /** Floating toolbar dropped: dock to this side. */
  onSide(side: 'left' | 'right'): void;
}

function Swatch({ colour, active, label, onPress, ring }: { colour: string; active: boolean; label: string; onPress: () => void; ring: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} hitSlop={4} style={styles.swatchHit}>
      <View style={[styles.swatch, { backgroundColor: colour, borderColor: active ? ring : 'transparent' }]} />
    </Pressable>
  );
}

function ToolButton({ icon, label, active, onPress, testID }: { icon: IconName; label: string; active: boolean; onPress: () => void; testID?: string }) {
  const th = useTheme();
  return (
    <View style={[styles.tool, active && { backgroundColor: th.primary.fill, borderRadius: th.radius.chip }]}>
      <IconButton icon={icon} label={label} onPress={onPress} color={active ? th.primary.text : th.text} testID={testID} />
    </View>
  );
}

export function InkToolbar(p: InkToolbarProps) {
  const th = useTheme();
  const t = p.tools;
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [parentWidth, setParentWidth] = useState(0);

  const handle = usePanGesture({
    runOnJS: true,
    onUpdate: (e) => setDrag({ x: e.translationX, y: e.translationY }),
    onDeactivate: (e) => {
      // Snap to the nearer edge (handedness) and remember it.
      const startX = p.side === 'left' ? 0 : parentWidth;
      const endX = startX + e.translationX;
      p.onSide(endX < parentWidth / 2 ? 'left' : 'right');
      setDrag({ x: 0, y: 0 });
    },
  });

  const pens = ([0, 1, 2] as const).map((i) => (
    <Swatch
      key={i}
      colour={p.pens[i]}
      ring={th.text}
      active={t.tool === 'pen' && t.pen === i && !t.custom}
      label={S.pen(i + 1)}
      onPress={() => p.onTools({ tool: 'pen', pen: i, custom: null })}
    />
  ));
  const tools = (
    <>
      {pens}
      <Swatch colour={p.highlighter} ring={th.text} active={t.tool === 'hl'} label={S.highlighter} onPress={() => p.onTools({ tool: 'hl' })} />
      <ToolButton
        icon={t.eraserMode === 'partial' ? 'cut-outline' : 'remove-circle-outline'}
        label={t.tool === 'eraser' ? (t.eraserMode === 'stroke' ? S.eraserWhole : S.eraserPartial) : S.eraser}
        active={t.tool === 'eraser'}
        onPress={() => p.onTools(t.tool === 'eraser' ? { eraserMode: t.eraserMode === 'stroke' ? 'partial' : 'stroke' } : { tool: 'eraser' })}
        testID="ink-eraser"
      />
      <ToolButton icon="scan-outline" label={S.lasso} active={t.tool === 'lasso'} onPress={() => p.onTools({ tool: 'lasso' })} testID="ink-lasso" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Width: ${S.width[t.width]}`}
        onPress={() => p.onTools({ width: ((t.width + 1) % 3) as 0 | 1 | 2 })}
        style={styles.widthBtn}
        testID="ink-width"
      >
        <View style={[styles.widthLine, { height: [2, 4, 7][t.width], backgroundColor: th.text }]} />
      </Pressable>
    </>
  );
  const actions = (
    <>
      <IconButton icon="arrow-undo-outline" label={S.undo} onPress={p.onUndo} disabled={!p.canUndo} testID="ink-undo" />
      <IconButton icon="arrow-redo-outline" label={S.redo} onPress={p.onRedo} disabled={!p.canRedo} testID="ink-redo" />
      {p.hasSelection ? (
        <>
          <IconButton icon="trash-outline" label={S.deleteSelection} onPress={p.onDeleteSelection} testID="ink-sel-delete" />
          <IconButton icon="color-palette-outline" label={S.recolourSelection} onPress={p.onRecolourSelection} testID="ink-sel-recolour" />
          <IconButton icon="close-circle-outline" label={S.clearSelection} onPress={p.onClearSelection} />
        </>
      ) : null}
      <IconButton icon="ellipsis-horizontal" label={S.more} onPress={p.onMore} testID="ink-more" />
      <Pressable accessibilityRole="button" accessibilityLabel={S.done} onPress={p.onDone} style={[styles.done, { backgroundColor: th.primary.fill, borderRadius: th.radius.chip }]} testID="ink-done">
        <Text style={{ color: th.primary.text, fontWeight: '700' }}>Done</Text>
      </Pressable>
    </>
  );

  if (p.variant === 'bar') {
    return (
      <View style={[styles.bar, { backgroundColor: th.surface, borderTopColor: th.line }]} testID="ink-toolbar">
        <View style={styles.row}>{tools}</View>
        <View style={styles.row}>{actions}</View>
      </View>
    );
  }

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.floatHost]}
      pointerEvents="box-none"
      onLayout={(e: LayoutChangeEvent) => setParentWidth(e.nativeEvent.layout.width)}
    >
      <View
        testID="ink-toolbar"
        style={[
          styles.pill,
          p.side === 'left' ? { left: 8 } : { right: 8 },
          { backgroundColor: th.surface, borderColor: th.line, transform: [{ translateX: drag.x }, { translateY: drag.y }] },
        ]}
      >
        <GestureDetector gesture={handle}>
          <View accessibilityRole="adjustable" accessibilityLabel={S.dragToolbar} style={styles.handle}>
            <View style={[styles.grip, { backgroundColor: th.muted }]} />
          </View>
        </GestureDetector>
        {tools}
        {actions}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 4, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  floatHost: { justifyContent: 'center' },
  pill: { position: 'absolute', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, gap: 2, elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  handle: { width: 44, height: 24, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 24, height: 4, borderRadius: 2 },
  swatchHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 3 },
  tool: { alignItems: 'center', justifyContent: 'center' },
  widthBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  widthLine: { width: 22, borderRadius: 4 },
  done: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', marginLeft: 4 },
});
