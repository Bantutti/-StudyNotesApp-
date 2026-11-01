/**
 * All user-facing app text lives here (plan 9.8: strings externalized from
 * day one, so a Filipino translation is a new table, not a code change).
 *
 * Usage: t('home.title') or t('notes.count', { count: 3 }).
 * Placeholders are {name}. Values are plain text (React Native <Text> never
 * interprets markup). Tone (plan 9.6): short, friendly, specific, never blaming.
 */
export const EN = {
  /** The visible app name: change it here only (app.json "name" must match; a test checks). */
  'app.name': 'NotedPo',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.undo': 'Undo',
  'common.done': 'Done',
  'common.skip': 'Skip',
  'common.next': 'Next',
  'common.back': 'Back',
  'common.rename': 'Rename',
  'common.untitled': 'Untitled',
  'common.sample': 'Sample',
  'common.error': 'Something went wrong. Please try again.',

  'welcome.capture.title': 'Capture',
  'welcome.capture.body': 'Type your notes now. Lectures and drawing come soon.',
  'welcome.shape.title': 'Shape',
  'welcome.shape.body': 'Pick a look and let Beautify tidy your page.',
  'welcome.review.title': 'Review',
  'welcome.review.body': 'Definitions and highlights become study cards later.',
  'welcome.start': 'Get started',
  'welcome.title': 'Welcome to {app}',
  'look.title': 'Pick your look',
  'look.body': 'You can change it any time, for any note.',
  'subject.first.title': 'Add your first subject',
  'subject.first.body': 'Like Biology or History. You can add more later.',
  'subject.name': 'Subject name',
  'subject.color': 'Colour',
  'subject.examDate': 'Exam date (optional)',
  'subject.create': 'Create subject',

  'tab.home': 'Home',
  'tab.subjects': 'Subjects',
  'tab.new': 'New',
  'tab.me': 'Me',

  'home.continue': 'Continue where you left off',
  'home.recent': 'Recent notes',
  'home.firstNote': 'Create your first note',
  'home.searchPlaceholder': 'Search your notes',
  'home.examIn': '{subject} exam in {days} days',
  'home.examToday': '{subject} exam is today',

  'subjects.title': 'Subjects',
  'subjects.inbox': 'Inbox',
  'subjects.new': 'New subject',
  'subjects.noteCount.one': '1 note',
  'subjects.noteCount.other': '{count} notes',
  'subjects.empty': 'Nothing here yet.',
  'subjects.deleteAsk': 'Delete "{name}"?',
  'subjects.deleteMove': 'Move its notes to Inbox',
  'subjects.deleteAll': 'Delete its notes too',
  'folders.new': 'New folder',

  'notes.new': 'New note',
  'notes.fromTemplate': 'From template',
  'notes.deleted.one': 'Note deleted',
  'notes.deleted.other': '{count} notes deleted',
  'notes.tooLarge': 'This note is getting long. Over {percent}% of the size that can sync.',

  'editor.mode.type': 'Type',
  'editor.mode.draw': 'Draw',
  'editor.mode.style': 'Style',
  'editor.drawSoon': 'Drawing arrives in a later update.',
  'editor.saved': 'Saved on device',

  'link.openTitle': 'Open link?',
  'link.openTitle.hint': 'Select some text first. Links open in your browser, outside {app}.',
  'link.openBody': 'This opens {host} in your browser, outside {app}.',

  'search.empty': 'No notes match "{query}".',
  'me.deleteAll': 'Delete all data',
  'me.deleteAllAsk': 'This deletes every note, subject and setting on this phone. It can’t be undone.',
  'mic.denied': 'Microphone permission denied. Enable it in Settings > Apps > {app} > Permissions.',
} as const;

export type StringKey = keyof typeof EN;
export type StringTable = Record<StringKey, string>;

let table: StringTable = EN;

/** Swaps the active table (future localization; tests). */
export function setStrings(next: StringTable): void {
  table = next;
}

/** Fills {placeholders}; {app} is always the app name from this table. */
export function t(key: StringKey, vars?: Readonly<Record<string, string | number>>): string {
  const s = table[key] ?? EN[key];
  const all: Record<string, string | number> = { app: table['app.name'] ?? EN['app.name'], ...vars };
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in all ? String(all[name]) : m));
}

/** Picks the .one / .other form for a count. */
export function tCount(base: 'subjects.noteCount' | 'notes.deleted', count: number): string {
  return t(`${base}.${count === 1 ? 'one' : 'other'}` as StringKey, { count });
}
