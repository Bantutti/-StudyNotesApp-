/**
 * Every user-facing text on the AI screens (Plan 9.8: externalised, so a
 * Filipino translation is a new table, not a code change).
 *
 * Kept in this module rather than appended to core/strings.ts so the shared
 * file changes by only 3 lines (the Lead's rule for wave 2, where P2b edits
 * core/strings.ts in parallel). Same rules as core's t(): {name}
 * placeholders, plain text only (React Native <Text> never interprets
 * markup), {app} is the app name. Tone (Plan 9.6): short, friendly,
 * specific, never blaming; name the provider; give one next step.
 *
 * Age screen rule (Q2 = A): the AGE screen strings never mention 18 or
 * "adult" before the answer. Tested.
 */
import { t } from '@/core';

export const AI_EN = {
  'ai.title': 'AI',
  'ai.close': 'Close',

  'ai.demo.tag': 'DEMO',
  'ai.demo.banner': 'Demo AI is on: answers are made up on this phone from your own text, and nothing is sent. Turn it off in Me → AI.',
  'ai.demo.switch': 'Demo AI (developer builds only)',
  'ai.demo.switchDetail': 'Fake answers from your own text, for trying the screens without a key. Never in release builds.',

  'ai.action.beautify': 'Tidy the page: headings, definition boxes and highlights.',
  'ai.action.summarize': 'Add a short list of the main points.',
  'ai.action.explain': 'Explain the selected part simply, with an example.',
  'ai.action.flashcards': 'Turn the key facts into study cards.',
  'ai.action.quiz': 'Make practice questions from this note.',
  'ai.action.cleanTranscript': 'Fix punctuation and remove filler words from a lecture transcript.',
  'ai.action.clarify': 'Rewrite unclear sentences, keeping your meaning.',
  'ai.action.simplify': 'Use simpler, shorter words.',
  'ai.action.translate': 'Translate Tagalog, Cebuano or Taglish parts to English.',
  'ai.action.expand': 'Add short background where it helps (marked as AI-added).',
  'ai.action.keyTerms': 'List the important terms with short definitions.',

  'ai.guard.emptyDoc': 'This note couldn’t be read just now, so AI didn’t run. Nothing was changed. Close the note, open it again and retry.',
  'ai.guard.emptyResult': 'This would have removed all the text in your note, so it wasn’t applied. Nothing was changed.',

  'ai.notice.cancelled': 'Cancelled. Nothing was changed.',
  'ai.notice.notSent': 'Nothing was sent.',
  'ai.notice.discarded': 'Discarded. Your note wasn’t changed.',

  'ai.sheet.scope': 'Use',
  'ai.sheet.selection': 'Selection',
  'ai.sheet.note': 'Whole note',
  'ai.sheet.selectHint': 'To work on one part, or to use Explain, select text in the note first.',
  'ai.sheet.provider': 'AI provider',
  'ai.sheet.noKey': '{provider} (no key yet)',
  'ai.sheet.keyLater': 'You’ll add a free {provider} key when you pick an action.',
  'ai.sheet.limitsChecked': 'Free limits last checked on {date}.',
  'ai.sheet.actions': 'Actions',
  'ai.sheet.needsSelection': 'Select text in the note first.',
  'ai.sheet.replaceKey': 'Replace your {provider} key',

  'ai.usage.ofLimit': '{provider} · {count} of {limit} requests today.',
  'ai.usage.noLimit': '{provider} · {count} requests today ({provider} doesn’t publish its free limits).',
  'ai.usage.remaining': '{left} left, says the provider.',
  'ai.wait.seconds': '{s} s',

  // Age screen: neutral wording, no cut-off shown before the answer (Q2 = A).
  'ai.age.title': 'What year were you born?',
  'ai.age.why': 'Some features depend on your age.',
  'ai.age.yearLabel': 'Year of birth',
  'ai.age.monthTitle': 'Which month were you born in?',
  'ai.age.dayTitle': 'Which day of the month?',
  'ai.age.dayLabel': 'Day',
  'ai.age.badYear': 'Please enter your 4-digit year of birth.',
  'ai.age.badMonth': 'Please pick a month.',
  'ai.age.badDay': 'Please enter a day that exists in that month.',
  'ai.age.privacy': 'Your answer stays on this phone. {app} keeps only whether AI is available to you, not your birth date.',

  'ai.minor.title': 'AI isn’t available',
  'ai.minor.body': 'AI features are for people 18 and older, because the free AI providers only allow adults.',
  'ai.minor.lite': 'Beautify Lite (the wand button in the toolbar) still tidies your notes on this phone, with no account and no internet.',
  'ai.minor.recheck': 'Check my age again',

  'ai.blocked.title': 'AI is off for this subject',
  'ai.blocked.body': 'This subject is set to “Never send to AI”, so nothing from it is sent. You can change this in Me → AI.',

  'ai.badge.free': 'Free plan',
  'ai.badge.noCard': 'No card needed',
  'ai.badge.strict': 'Reliable answers',
  'ai.badge.lectures': 'Also transcribes lectures',
  'ai.badge.trains': 'May train on your notes unless you turn it off',

  'ai.key.title': 'Set up AI',
  'ai.key.intro': 'AI uses your own free key from a provider. The key stays in this phone’s secure storage and is sent only to that provider.',
  'ai.key.saved': 'Key saved',
  'ai.key.choose': 'Use {provider}',
  'ai.key.addTitle': 'Add your {provider} key',
  'ai.key.replaceTitle': 'Replace your {provider} key',
  'ai.key.step1': '1. Open {provider}’s key page and sign in (free).',
  'ai.key.openPage': 'Open {provider} key page',
  'ai.key.step2': '2. Create a key and copy it.',
  'ai.key.step3': '3. Come back here and paste it.',
  'ai.key.pasteLabel': 'Your {provider} key',
  'ai.key.paste': 'Paste',
  'ai.key.testSave': 'Test and save key',
  'ai.key.rejected': 'This key was rejected by {provider}. Check that you copied all of it.',
  'ai.key.uncheckedHint': 'You can save it now and it will be checked on first use.',
  'ai.key.saveAnyway': 'Save anyway',
  'ai.key.safety': 'Never share your key or paste it anywhere else. After saving, a copied key is cleared from your clipboard.',
  'ai.key.otherProvider': 'Choose a different provider',
  'ai.key.learnMore': 'Learn more (opens in your browser)',

  'ai.consent.title': 'Send to {provider}?',
  'ai.consent.recipient': 'Who receives it',
  'ai.consent.dataSent': 'What is sent',
  'ai.consent.purpose': 'Why',
  'ai.consent.dataUse': 'What {provider} does with it',
  'ai.consent.privacy': '{provider} privacy',
  'ai.consent.terms': '{provider} terms',
  'ai.consent.yes': 'Yes, send to {provider}',
  'ai.consent.no': 'Not now',
  'ai.consent.change': 'You can withdraw this any time in Me → AI.',

  'ai.run.working': 'Working',
  'ai.run.starting': 'Getting ready for {provider}…',
  'ai.run.sending': 'Waiting for {provider}…',
  'ai.run.sendingPart': 'Waiting for {provider}… (part {part} of {parts})',
  'ai.run.pacing': 'Pacing for the free plan: {wait}.',
  'ai.run.retrying': '{provider} is busy. Trying again in {wait}.',
  'ai.run.reasking': 'Checking {provider}’s answer and asking once more…',
  'ai.run.fallback': 'Trying {provider}’s backup model…',

  'ai.preview.summary': '{n} suggested changes from {provider}. {sent} blocks were sent.',
  'ai.preview.keptSubitems': 'Some list items with sub-items were kept as they were.',
  'ai.preview.acceptAll': 'Accept all',
  'ai.preview.before': 'Before',
  'ai.preview.after': 'After',
  'ai.preview.added': 'Added',
  'ai.preview.willRemove': 'This block will be removed.',
  'ai.preview.nothing': '(empty)',
  'ai.preview.aiAdded': 'AI-added',
  'ai.preview.stale': 'Changed since',
  'ai.preview.staleDetail': 'You edited this block after it was sent, so this change can’t be applied.',
  'ai.preview.accept': 'Accept change {n}',
  'ai.preview.removedWords': 'Removed:',
  'ai.preview.addedWords': 'Added:',
  'ai.preview.apply': 'Apply {n}',
  'ai.preview.applyNone': 'Nothing selected',
  'ai.preview.discard': 'Discard',
  'ai.preview.undoHint': 'After applying you can Undo, and the earlier version is kept in History.',

  'ai.empty.title': 'Nothing to change',
  'ai.empty.body': '{provider} didn’t suggest any changes for this part.',

  'ai.error.title': 'That didn’t work',
  'ai.error.retry': 'Try again',
  'ai.error.replaceKey': 'Replace key',
  'ai.error.switch': 'Use {provider} instead',
  'ai.error.useLite': 'OK',

  'ai.report.button': 'Report this AI result',
  'ai.report.title': 'What’s wrong with it?',
  'ai.report.intro': 'This helps you keep track of problems. Your note and the AI’s answer are not saved in the report.',
  'ai.report.wrong': 'It’s wrong',
  'ai.report.harmful': 'Harmful or offensive',
  'ai.report.changedMeaning': 'It changed what I meant',
  'ai.report.brokeFormat': 'It messed up my note',
  'ai.report.other': 'Something else',
  'ai.report.comment': 'Comment (optional)',
  'ai.report.save': 'Save report',
  'ai.report.saved': 'Report saved on this phone.',
  'ai.report.local': 'Reports are saved only on this phone. Nothing is sent.',

  'ai.settings.title': 'AI',
  'ai.settings.age': 'Age check',
  'ai.settings.ageAdult': 'AI is available to you (checked on {date}).',
  'ai.settings.ageMinor': 'AI isn’t available to you (checked on {date}). Beautify Lite still works.',
  'ai.settings.ageUnknown': 'Not checked yet. You’ll be asked the first time you use AI.',
  'ai.settings.checkNow': 'Answer it now',
  'ai.settings.keysNeedAge': 'Keys can be added after the age check, and only if AI is available to you.',
  'ai.settings.providers': 'Providers',
  'ai.settings.default': 'Default',
  'ai.settings.keyMasked': 'Key: {masked}',
  'ai.settings.noKey': 'No key saved.',
  'ai.settings.tokens': '{n} tokens today. Free limits last checked on {date}.',
  'ai.settings.limitsPage': 'See your {provider} limits (opens in your browser)',
  'ai.settings.add': 'Add key',
  'ai.settings.replace': 'Replace key',
  'ai.settings.test': 'Test key',
  'ai.settings.remove': 'Remove key',
  'ai.settings.removeTitle': 'Remove your {provider} key?',
  'ai.settings.removeBody': 'It is deleted from this phone. You can add a key again any time.',
  'ai.settings.keyOk': '{provider} accepted your key.',
  'ai.settings.testFailed': 'The key could not be checked right now. Try again.',
  'ai.settings.consentYes': 'You allowed sending notes to this provider.',
  'ai.settings.consentNo': 'You haven’t allowed sending notes yet (asked on first use).',
  'ai.settings.withdraw': 'Withdraw permission',
  'ai.settings.makeDefault': 'Use by default',
  'ai.settings.subjects': 'Subjects',
  'ai.settings.subjectsHint': 'Turn on “Never send to AI” for subjects with private notes. AI then won’t work in those notes.',
  'ai.settings.noSubjects': 'No subjects yet.',
  'ai.settings.never': '{name}: never send to AI',
  'ai.settings.reports': 'Your AI reports',
  'ai.settings.noReports': 'No reports.',
  'ai.settings.deleteReport': 'Delete report',
  'ai.settings.developer': 'Developer',
  'ai.settings.footer': 'Keys are kept only in this phone’s secure storage and sent only to their provider. Delete all data removes keys, answers, reports and usage counts.',
} as const;

export type AiStringKey = keyof typeof AI_EN;
export type AiStringTable = Record<AiStringKey, string>;

let table: AiStringTable = AI_EN;

/** Swaps the active table (future localisation; tests). */
export function setAiStrings(next: AiStringTable): void {
  table = next;
}

/** Same rules as core t(): fills {placeholders}; {app} is the app name. */
export function ta(key: AiStringKey, vars?: Readonly<Record<string, string | number>>): string {
  const s = table[key] ?? AI_EN[key];
  const all: Record<string, string | number> = { app: t('app.name'), ...vars };
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in all ? String(all[name]) : m));
}
