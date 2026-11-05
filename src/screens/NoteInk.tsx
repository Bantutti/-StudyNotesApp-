/**
 * Draw mode on the note screen (P4b). Thin React wrappers around
 * composition/noteInk.ts (all logic lives there and is unit-tested):
 *  - useNoteInk: creates one NoteInk per note screen and mirrors its state;
 *  - NoteInkOverlay: the live-stroke surface over the editor page, plus the
 *    floating toolbar on tablets (docked left or right);
 *  - NoteInkBar: the bottom toolbar on phones (replaces the keyboard toolbar);
 *  - the ⋯ menu (input mode, finger drawing, toolbar side, custom colour,
 *    hidden drawings, tips) uses native alerts on both platforms.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Alert, Platform, useWindowDimensions } from 'react-native';

import { createNoteInk, useServices, type NoteInk, type NoteInkState } from '@/composition';
import { getDeviceInfo, type NoteDoc } from '@/core';
import type { EditorHandle } from '@/modules/editor';
import { CUSTOM_PEN_COLOURS, INK_STRINGS as S, InkOverlay, InkToolbar, type InkInputMode } from '@/modules/ink';
import type { Store } from '@/modules/store';
import type { StylePack } from '@/modules/stylepacks';

const TABLET_MIN_WIDTH = 600;

export function useNoteInk(args: {
  store: Store;
  noteId: string;
  editor: RefObject<EditorHandle | null>;
  getLatestDoc: () => NoteDoc | null;
  onNoteUpdated: (updated: number) => void;
}): { ink: NoteInk; state: NoteInkState } {
  const { ids, logger } = useServices();
  const [state, setState] = useState<NoteInkState | null>(null);
  const [ink] = useState(() =>
    createNoteInk({
      store: args.store,
      ids,
      logger,
      noteId: args.noteId,
      editor: () => args.editor.current,
      getLatestDoc: args.getLatestDoc,
      onNoteUpdated: args.onNoteUpdated,
      onState: setState,
      strings: { full: S.full, nearlyFull: S.nearlyFull, noLayout: S.noLayout, damaged: S.damaged },
    }),
  );
  useEffect(() => {
    void ink.start().catch(() => logger.warn('ink.start_failed'));
    return () => ink.dispose();
  }, [ink, logger]);
  return { ink, state: state ?? ink.state };
}

/** Tablet layout: a floating, dockable toolbar (plan 9.7). */
export function useIsTablet(): boolean {
  const { width } = useWindowDimensions();
  return getDeviceInfo().isTablet || width >= TABLET_MIN_WIDTH;
}

function packColours(pack: StylePack | null) {
  const pens = (pack?.ink.pens ?? ['#1F2328', '#B42318', '#1E6B3A']) as readonly [string, string, string];
  return { pens, highlighter: pack?.ink.highlighter ?? '#FFE98A' };
}

function liveColour(state: NoteInkState, pack: StylePack | null): string {
  const { pens, highlighter } = packColours(pack);
  if (state.tools.tool === 'hl') return highlighter;
  return state.tools.custom ?? pens[state.tools.pen];
}

export function openInkMenu(
  ink: NoteInk,
  state: NoteInkState,
  getEditor?: () => EditorHandle | null,
  isActive: () => boolean = () => true,
): void {
  if (!isActive()) return;
  // Native dialogs can outlive their toolbar; never act on a disposed screen.
  const whileActive = (action: () => void) => () => { if (isActive()) action(); };
  const nextMode: Record<InkInputMode, InkInputMode> = { auto: 'stylus', stylus: 'finger', finger: 'auto' };
  const hidden = ink.detachedCount();
  const buttons: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [
    { text: S.input[state.inputMode], onPress: () => ink.setInputMode(nextMode[state.inputMode]) },
    { text: state.fingerDraw ? S.fingerDrawOn : S.fingerDrawOff, onPress: () => ink.toggleFingerDraw() },
    { text: S.side[state.side === 'left' ? 'right' : 'left'], onPress: () => ink.setSide(state.side === 'left' ? 'right' : 'left') },
    {
      text: S.customColour,
      onPress: () => {
        const cur = state.tools.custom;
        const i = cur ? CUSTOM_PEN_COLOURS.indexOf(cur as (typeof CUSTOM_PEN_COLOURS)[number]) : -1;
        ink.setTools({ tool: 'pen', custom: CUSTOM_PEN_COLOURS[(i + 1) % CUSTOM_PEN_COLOURS.length] as string });
      },
    },
  ];
  if (getEditor) buttons.push({ text: S.sketchTaller, onPress: () => getEditor()?.command('sketchTaller') });
  if (hidden > 0) {
    buttons.push({
      text: S.detached(hidden),
      style: 'destructive',
      onPress: () =>
        Alert.alert(S.detached(hidden), S.detachedHelp, [
          { text: S.cancel, style: 'cancel' },
          { text: S.detached(hidden), style: 'destructive', onPress: whileActive(() => {
            // A different hidden count means the confirmation no longer describes the operation.
            if (ink.detachedCount() !== hidden) {
              Alert.alert(S.menuTitle, 'Hidden drawings changed. Reopen the drawing menu to review them.');
              return;
            }
            ink.deleteDetached();
          }) },
        ]),
    });
  }
  buttons.push({ text: S.tips, onPress: () => Alert.alert(S.tips, S.tipsText) });

  // All callbacks, including page navigation and confirmations, are inert once
  // the toolbar goes away. Keep iOS's existing single, full-choice alert.
  for (const button of buttons) {
    if (button.onPress) button.onPress = whileActive(button.onPress);
  }
  const cancel = { text: S.cancel, style: 'cancel' as const };
  if (Platform.OS !== 'android') {
    Alert.alert(S.menuTitle, undefined, [...buttons, cancel]);
    return;
  }

  // Android accepts only three buttons. Put Cancel in the negative slot and
  // use the positive slot for Next; the last page can hold two actions.
  const showPage = (index: number) => {
    if (!isActive()) return;
    const remaining = buttons.length - index;
    const actions = remaining > 2
      ? [buttons[index]!, cancel, { text: 'More options', onPress: whileActive(() => showPage(index + 1)) }]
      : [buttons[index]!, cancel, ...buttons.slice(index + 1)];
    Alert.alert(S.menuTitle, undefined, actions, { cancelable: true });
  };
  showPage(0);
}

/** Invalidate old dialog callbacks on unmount, Draw exit, or a new toolbar lifetime. */
function useInkMenuGuard(drawMode: boolean): () => () => boolean {
  const lifetime = useRef<object | null>(null);
  useEffect(() => {
    lifetime.current = drawMode ? {} : null;
    return () => { lifetime.current = null; };
  }, [drawMode]);
  return () => {
    const openedIn = lifetime.current;
    return () => openedIn !== null && lifetime.current === openedIn;
  };
}

function toolbarProps(ink: NoteInk, state: NoteInkState, pack: StylePack | null, getEditor: (() => EditorHandle | null) | undefined, menuGuard: () => () => boolean) {
  const { pens, highlighter } = packColours(pack);
  return {
    side: state.side,
    tools: state.tools,
    pens,
    highlighter,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    hasSelection: state.selectionBox !== null,
    onTools: (p: Parameters<NoteInk['setTools']>[0]) => ink.setTools(p),
    onUndo: () => ink.undo(),
    onRedo: () => ink.redo(),
    onMore: () => openInkMenu(ink, state, getEditor, menuGuard()),
    onDone: () => ink.setDrawMode(false),
    onDeleteSelection: () => ink.deleteSelection(),
    onRecolourSelection: () => ink.recolourSelection(),
    onClearSelection: () => ink.clearSelection(),
    onSide: (side: 'left' | 'right') => ink.setSide(side),
  };
}

/** Over the editor page (inside the same box as EditorView). Draw mode only. */
export function NoteInkOverlay({ ink, state, pack, tablet, getEditor }: { ink: NoteInk; state: NoteInkState; pack: StylePack | null; tablet: boolean; getEditor?: () => EditorHandle | null }) {
  const menuGuard = useInkMenuGuard(state.drawMode && tablet);
  if (!state.drawMode) return null;
  return (
    <>
      <InkOverlay
        tool={state.tools.tool}
        colour={liveColour(state, pack)}
        widthPx={ink.controller?.currentWidthPx() ?? 3}
        inputMode={state.inputMode}
        fingerDraw={state.fingerDraw}
        stylusSeen={state.stylusSeen}
        clearKey={state.clearKey}
        selectionBox={state.selectionBox}
        onStroke={(pts) => ink.stroke(pts)}
        onEraseStart={() => ink.eraseStart()}
        onErase={(x, y) => ink.erase(x, y)}
        onEraseEnd={() => ink.eraseEnd()}
        onLasso={(pts) => ink.lasso(pts)}
        onMoveSelection={(dx, dy) => ink.moveSelection(dx, dy)}
        onScroll={(dx, dy) => ink.scroll(dx, dy)}
        onFling={(vx, vy) => ink.fling(vx, vy)}
        onZoom={(s) => ink.zoom(s)}
        onStylusSeen={() => ink.stylusSeen()}
      />
      {tablet ? <InkToolbar variant="floating" {...toolbarProps(ink, state, pack, getEditor, menuGuard)} /> : null}
    </>
  );
}

/** The phone toolbar (bottom). */
export function NoteInkBar({ ink, state, pack, getEditor }: { ink: NoteInk; state: NoteInkState; pack: StylePack | null; getEditor?: () => EditorHandle | null }) {
  const menuGuard = useInkMenuGuard(state.drawMode);
  return <InkToolbar variant="bar" {...toolbarProps(ink, state, pack, getEditor, menuGuard)} />;
}
