/**
 * Ink UI text (P4b). Kept inside the ink module so P4b doesn't edit the
 * shared core/strings.ts that other phases change in parallel. Short,
 * friendly, specific (plan 9.6 tone).
 */
export const INK_STRINGS = {
  pen: (n: number) => `Pen ${n}`,
  highlighter: 'Highlighter',
  eraser: 'Eraser',
  eraserWhole: 'Eraser: whole strokes',
  eraserPartial: 'Eraser: just the part you touch',
  lasso: 'Lasso: circle strokes to move, recolour or delete',
  width: ['Thin', 'Medium', 'Thick'] as const,
  undo: 'Undo drawing',
  redo: 'Redo drawing',
  more: 'More drawing options',
  done: 'Done drawing',
  dragToolbar: 'Move the drawing toolbar',
  deleteSelection: 'Delete selected strokes',
  recolourSelection: 'Recolour selected strokes',
  clearSelection: 'Clear selection',
  menuTitle: 'Drawing',
  fingerDrawOn: 'Draw with finger: on',
  fingerDrawOff: 'Draw with finger: off',
  input: { auto: 'Pen input: automatic', stylus: 'Pen input: stylus only', finger: 'Pen input: finger draws' } as const,
  side: { left: 'Toolbar on the left', right: 'Toolbar on the right' } as const,
  customColour: 'Custom pen colour',
  sketchTaller: 'Make the selected sketch taller',
  detached: (n: number) => (n === 1 ? 'Delete 1 hidden drawing' : `Delete ${n} hidden drawings`),
  detachedHelp:
    'Hidden drawings belong to lines you deleted. They come back if you undo or restore that line. Delete them to free space.',
  tips: 'Tips',
  tipsText:
    'Use two fingers to scroll and pinch to zoom. With a stylus, the pen draws and your finger scrolls. Tap the eraser again to switch between whole strokes and partial erasing.',
  firstTime: 'Two fingers scroll the page while you draw.',
  full: 'This drawing is full. Delete some strokes or start a new note.',
  nearlyFull: 'This drawing is nearly full.',
  noLayout: 'The page is still loading. Try again in a moment.',
  damaged: 'Part of this drawing could not be opened because its data is damaged. Your last good copy is shown.',
  cancel: 'Cancel',
} as const;

/** Extra pen colours offered by "Custom pen colour" (all at least 4.5:1 on white paper). */
export const CUSTOM_PEN_COLOURS = ['#1F3A5F', '#B42318', '#1E6B3A', '#6B2FA3', '#9A4A00', '#222222'] as const;
