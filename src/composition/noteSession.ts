/**
 * One editing session of a note: autosave plus the bookkeeping the editor
 * screen needs (last stored version time, latest document from the editor).
 * A plain object so the screen holds no refs (React Compiler friendly) and
 * the logic is testable.
 *
 * Live pull: the editor page sends changes 400 ms after typing stops and
 * never mid-composition, so the last word can still be only in the WebView.
 * flush() and leave() first ask the editor for its live document (the
 * screen sets the source with setLiveSource) and save that. A pull that
 * fails (invalid document, editor gone, too slow) keeps the last good one.
 */
import { DOCUMENT_LIMITS, t, userMessage, type NoteDoc } from '@/core';
import type { Store } from '@/modules/store';

import { createAutosave } from './autosave';
import { checkpointOnLeave, checkpointWhileEditing } from './versions';

export type LiveDocSource = () => Promise<NoteDoc | null>;

export function createNoteSession(deps: {
  store: Store;
  noteId: string;
  onBanner: (text: string | null) => void;
  now?: () => number;
  /** How long flush/leave wait for the editor's live document (default 1.5 s). */
  liveTimeoutMs?: number;
}) {
  const now = deps.now ?? Date.now;
  const liveTimeoutMs = deps.liveTimeoutMs ?? 1_500;
  let lastUpdated = 0;
  let latestDoc: NoteDoc | null = null;
  let live: LiveDocSource | null = null;
  let leaving: Promise<void> | null = null;
  let disposeRequested = false;
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
  const edited = (doc: NoteDoc) => {
    latestDoc = doc;
    autosave.change(doc);
  };

  /** Asks the editor for its live document; a newer one goes to autosave. */
  const pullLive = async (): Promise<void> => {
    const source = live;
    if (!source) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const doc = await Promise.race([
        source(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), liveTimeoutMs);
        }),
      ]);
      if (doc && JSON.stringify(doc) !== JSON.stringify(latestDoc)) edited(doc);
    } catch {
      // Invalid live document or editor gone: keep the last good document (the screen shows a banner).
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };

  const flush = async () => {
    await pullLive();
    await autosave.flush();
  };

  return {
    autosave,
    /** Where flush/leave get the editor's live document (null when there is no editor). */
    setLiveSource(source: LiveDocSource | null) {
      live = source;
    },
    /** Saves now, including what is only in the editor page so far. */
    flush,
    /** The document the editor should show after (re)starting: the newest one, not the one from opening. */
    readyDoc: (opened: NoteDoc): NoteDoc => latestDoc ?? opened,
    /** The stored note changed outside this editor (restore, template, style) since we last saw it. */
    changedElsewhere: (updated: number) => lastUpdated !== 0 && updated > lastUpdated,
    seen(updated: number) {
      lastUpdated = Math.max(lastUpdated, updated);
    },
    edited,
    shown(doc: NoteDoc) {
      latestDoc = doc;
      autosave.reset();
    },
    get latestDoc() {
      return latestDoc;
    },
    /** Leaving the note: save now, then the "when you left" version. */
    leave(): Promise<void> {
      const run = (async () => {
        await flush();
        await checkpointOnLeave(deps.store, deps.noteId, autosave.changedThisSession);
      })();
      leaving = run.finally(() => {
        leaving = null;
        if (disposeRequested) autosave.dispose();
      });
      return run;
    },
    /** Stops autosave; a leave in progress still finishes its save first. */
    dispose() {
      disposeRequested = true;
      if (!leaving) autosave.dispose();
    },
  };
}
export type NoteSession = ReturnType<typeof createNoteSession>;
