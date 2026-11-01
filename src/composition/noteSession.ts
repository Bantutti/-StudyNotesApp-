/**
 * One editing session of a note: autosave plus the bookkeeping the editor
 * screen needs (last stored version time, latest document from the editor).
 * A plain object so the screen holds no refs (React Compiler friendly) and
 * the logic is testable.
 */
import { DOCUMENT_LIMITS, t, userMessage, type NoteDoc } from '@/core';
import type { Store } from '@/modules/store';

import { createAutosave } from './autosave';
import { checkpointOnLeave, checkpointWhileEditing } from './versions';

export function createNoteSession(deps: { store: Store; noteId: string; onBanner: (text: string | null) => void; now?: () => number }) {
  const now = deps.now ?? Date.now;
  let lastUpdated = 0;
  let latestDoc: NoteDoc | null = null;
  const autosave = createAutosave({
    save: (doc) => deps.store.notes.save(deps.noteId, { document: doc }),
    checkpoint: () => checkpointWhileEditing(deps.store, deps.noteId, now()),
    onSaved: (r) => {
      lastUpdated = Math.max(lastUpdated, r.note.updated);
      deps.onBanner(r.usage > DOCUMENT_LIMITS.warnRatio ? t('notes.tooLarge', { percent: Math.round(r.usage * 100) }) : null);
    },
    onError: (e) => deps.onBanner(`Not saved yet: ${userMessage(e)} Your text is kept on screen; it saves with your next change.`),
    now,
  });
  return {
    autosave,
    /** The stored note changed outside this editor (restore, template, style) since we last saw it. */
    changedElsewhere: (updated: number) => lastUpdated !== 0 && updated > lastUpdated,
    seen(updated: number) {
      lastUpdated = Math.max(lastUpdated, updated);
    },
    edited(doc: NoteDoc) {
      latestDoc = doc;
      autosave.change(doc);
    },
    shown(doc: NoteDoc) {
      latestDoc = doc;
      autosave.reset();
    },
    get latestDoc() {
      return latestDoc;
    },
    /** Leaving the note: save now, then the "when you left" version. */
    async leave() {
      await autosave.flush();
      await checkpointOnLeave(deps.store, deps.noteId, autosave.changedThisSession);
    },
    dispose: () => autosave.dispose(),
  };
}
export type NoteSession = ReturnType<typeof createNoteSession>;
