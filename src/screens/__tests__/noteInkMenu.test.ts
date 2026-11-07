/** Android Alert pagination keeps every action within the three-button limit;
 * iOS retains its single menu. These simulate presses, not native UI. */
import { act, createElement } from 'react';
import { Alert, Platform, type AlertButton } from 'react-native';
import { createRoot } from 'test-renderer';
import type { NoteInk, NoteInkState } from '@/composition';
import type { EditorHandle } from '@/modules/editor';
import { CUSTOM_PEN_COLOURS, DEFAULT_TOOLS, INK_STRINGS as S } from '@/modules/ink';
import { NoteInkBar, openInkMenu } from '../NoteInk';

// The menu needs only text and constants; avoid loading unrelated services and
// native drawing modules when exercising its Alert behavior.
jest.mock('@/composition', () => ({}));
jest.mock('@/core', () => ({}));
jest.mock('@/modules/ink', () => ({
  ...jest.requireActual('../../modules/ink/ui/strings'),
  DEFAULT_TOOLS: { tool: 'pen', pen: 0, custom: null, width: 1, eraserMode: 'stroke' },
  InkToolbar: 'InkToolbar',
}));

const state = (changes: Partial<NoteInkState> = {}): NoteInkState => ({
  ready: true, drawMode: true, tools: { ...DEFAULT_TOOLS }, canUndo: false, canRedo: false,
  selectionBox: null, stylusSeen: false, inputMode: 'auto', fingerDraw: false, side: 'right',
  clearKey: 0, strokes: 0, banner: null, showTip: false, ...changes,
});

function setup(hidden = 0) {
  const ink = {
    detachedCount: jest.fn(() => hidden), setInputMode: jest.fn(), toggleFingerDraw: jest.fn(),
    setSide: jest.fn(), setTools: jest.fn(), deleteDetached: jest.fn(),
  };
  const editor = { command: jest.fn() };
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  return { ink, editor, alert, open: (s = state(), withEditor = true, isActive?: () => boolean) => openInkMenu(ink as unknown as NoteInk, s, withEditor ? () => editor as unknown as EditorHandle : undefined, isActive) };
}

function current(alert: jest.SpyInstance): AlertButton[] {
  return alert.mock.calls[alert.mock.calls.length - 1]![2] as AlertButton[];
}
function press(buttons: AlertButton[], text: string) {
  const button = buttons.find((item) => item.text === text);
  expect(button).toBeDefined();
  button?.onPress?.();
}
function find(alert: jest.SpyInstance, label: string): AlertButton[] {
  for (let steps = 0; steps < 10; steps++) {
    const page = current(alert);
    if (page.some((button) => button.text === label)) return page;
    press(page, 'More options');
  }
  throw new Error(`Cannot reach ${label}`);
}

afterEach(() => jest.restoreAllMocks());

it('invalidates an old native menu across Draw exit, re-entry and toolbar unmount', async () => {
  const { ink, alert } = setup();
  const root = createRoot();
  const render = (drawMode: boolean) => root.render(createElement(NoteInkBar, {
    ink: ink as unknown as NoteInk, state: state({ drawMode }), pack: null,
  }));
  const toolbar = () => root.container.queryAll((node) => node.type === 'InkToolbar')[0]!;
  await act(async () => render(true));
  (toolbar().props.onMore as () => void)();
  const stale = current(alert);
  await act(async () => render(false));
  await act(async () => render(true));
  press(stale, S.input.auto);
  expect(ink.setInputMode).not.toHaveBeenCalled();
  (toolbar().props.onMore as () => void)();
  const beforeUnmount = current(alert);
  await act(async () => root.unmount());
  press(beforeUnmount, S.input.auto);
  expect(ink.setInputMode).not.toHaveBeenCalled();
});

describe.each(['android', 'ios'] as const)('drawing menu on %s', (platform) => {
  beforeEach(() => { jest.replaceProperty(Platform, 'OS', platform); });

  it.each([[0, false], [0, true], [2, false], [2, true]] as const)(
    'exposes every applicable action and safe cancellation (hidden=%s editor=%s)',
    (hidden, withEditor) => {
      const { open, alert, ink } = setup(hidden);
      open(state(), withEditor);
      const seen: string[] = [];
      for (;;) {
        const page = current(alert);
        if (platform === 'android') {
          expect(page.length).toBeLessThanOrEqual(3);
          expect(page[1]?.text).toBe(S.cancel); // Android's negative slot.
          expect(alert.mock.calls[alert.mock.calls.length - 1]![3]).toEqual({ cancelable: true });
        } else {
          expect(page.length).toBeGreaterThan(3); // Preserve iOS's original one-alert menu.
          expect(alert).toHaveBeenCalledTimes(1);
        }
        expect(page.find((button) => button.text === S.cancel)?.style).toBe('cancel');
        seen.push(...page.map((button) => button.text!).filter((text) => text !== S.cancel && text !== 'More options'));
        if (!page.some((button) => button.text === 'More options')) break;
        press(page, 'More options');
      }
      expect(seen).toEqual([
        S.input.auto, S.fingerDrawOff, S.side.left, S.customColour,
        ...(withEditor ? [S.sketchTaller] : []), ...(hidden ? [S.detached(hidden)] : []), S.tips,
      ]);
      // Navigating and cancelling must not invoke actions or delete anything.
      press(current(alert), S.cancel);
      expect(ink.setInputMode).not.toHaveBeenCalled();
      expect(ink.deleteDetached).not.toHaveBeenCalled();
    },
  );

  it('executes input, finger, side and colour actions with the existing values and cycles', () => {
    const { open, alert, ink } = setup();
    const s = state({ inputMode: 'stylus', fingerDraw: true, side: 'left', tools: { ...DEFAULT_TOOLS, custom: CUSTOM_PEN_COLOURS[CUSTOM_PEN_COLOURS.length - 1]! } });
    open(s); press(find(alert, S.input.stylus), S.input.stylus); expect(ink.setInputMode).toHaveBeenCalledWith('finger');
    open(s); press(find(alert, S.fingerDrawOn), S.fingerDrawOn); expect(ink.toggleFingerDraw).toHaveBeenCalledTimes(1);
    open(s); press(find(alert, S.side.right), S.side.right); expect(ink.setSide).toHaveBeenCalledWith('right');
    open(s); press(find(alert, S.customColour), S.customColour); expect(ink.setTools).toHaveBeenCalledWith({ tool: 'pen', custom: CUSTOM_PEN_COLOURS[0] });
  });

  it('does not act on a dialog after its toolbar lifetime ends', () => {
    const { open, alert, ink } = setup(2);
    let active = true;
    open(state(), true, () => active);
    const first = current(alert);
    active = false;
    press(first, S.input.auto);
    expect(ink.setInputMode).not.toHaveBeenCalled();
    if (platform === 'android') {
      const count = alert.mock.calls.length;
      press(first, 'More options');
      expect(alert).toHaveBeenCalledTimes(count);
    }
    active = true;
    open(state(), true, () => active);
    press(find(alert, S.detached(2)), S.detached(2));
    const confirmation = current(alert);
    active = false;
    press(confirmation, S.detached(2));
    expect(ink.deleteDetached).not.toHaveBeenCalled();
  });

  it('does not delete if the hidden drawing count changes during confirmation', () => {
    const { open, alert, ink } = setup(2);
    open(); press(find(alert, S.detached(2)), S.detached(2));
    ink.detachedCount.mockReturnValue(3);
    press(current(alert), S.detached(2));
    expect(ink.deleteDetached).not.toHaveBeenCalled();
    expect(alert).toHaveBeenLastCalledWith(S.menuTitle, 'Hidden drawings changed. Reopen the drawing menu to review them.');
  });

  it('invokes sketch and tips, and deletes hidden drawings only after explicit confirmation', () => {
    const { open, alert, editor, ink } = setup(2);
    open(); press(find(alert, S.sketchTaller), S.sketchTaller); expect(editor.command).toHaveBeenCalledWith('sketchTaller');
    open(); press(find(alert, S.tips), S.tips); expect(alert).toHaveBeenLastCalledWith(S.tips, S.tipsText);
    open(); press(find(alert, S.detached(2)), S.detached(2));
    expect(alert).toHaveBeenLastCalledWith(S.detached(2), S.detachedHelp, expect.any(Array));
    press(current(alert), S.cancel); expect(ink.deleteDetached).not.toHaveBeenCalled();
    open(); press(find(alert, S.detached(2)), S.detached(2));
    expect(current(alert).find((button) => button.text === S.detached(2))?.style).toBe('destructive');
    press(current(alert), S.detached(2)); expect(ink.deleteDetached).toHaveBeenCalledTimes(1);
  });
});
