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
  let docRevision = 0;
  let live: LiveDocSource | null = null;
  let activeOperations = 0;
  let disposeRequested = false;
  const autosave = createAutosave({
    save: (doc) => deps.store.notes.save(deps.noteId, { document: doc }),
    checkpoint: () => checkpointWhileEditing(deps.store, deps.noteId, now()),
    onSaved: (r) => {
      lastUpdated = Math.max(lastUpdated, r.note.updated);
      deps.onBanner(r.usage > DOCUMENT_LIMITS.warnRatio ? t('notes.tooLarge', { percent: Math.round(r.usage * 100) }) : null);
    },
    onError: (e) => deps.onBanner(`Not saved yet: ${userMessage(e)} Keep this note open and try another edit or retry saving before leaving.`),
    now,
  });
  const edited = (doc: NoteDoc) => {
    latestDoc = doc;
    docRevision++;
    autosave.change(doc);
  };
  const finishOperation = () => {
    activeOperations--;
    if (disposeRequested && activeOperations === 0) autosave.dispose();
  };

  /** Asks the editor for its live document; a newer one goes to autosave. */
  const pullLive = async (): Promise<void> => {
    const source = live;
    if (!source) return;
    const revisionAtPull = docRevision;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const doc = await Promise.race([
        source(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), liveTimeoutMs);
        }),
      ]);
      // A delayed pull must not replace an edit or restore received since it began.
      if (doc && docRevision === revisionAtPull && JSON.stringify(doc) !== JSON.stringify(latestDoc)) edited(doc);
    } catch {
      // Invalid live document or editor gone: keep the last good document (the screen shows a banner).
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };

  const flush = async () => {
    activeOperations++;
    try {
      await pullLive();
      await autosave.flush();
    } finally {
      finishOperation();
    }
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
      docRevision++;
      autosave.reset();
    },
    get latestDoc() {
      return latestDoc;
    },
    /** Leaving the note: save now, then the "when you left" version. */
    leave(): Promise<void> {
      activeOperations++;
      const run = (async () => {
        await flush();
        // Do not write a misleading leave version of an older stored document
        // if the attempted save failed. Edits during a checkpoint need another
        // flush before leaving, and a checkpoint of the resulting document.
        while (!autosave.hasPending) {
          const checkpointRevision = docRevision;
          try {
            await checkpointOnLeave(deps.store, deps.noteId, autosave.changedThisSession);
          } catch (e) {
            // Even when history fails, do not discard an edit made while the
            // checkpoint was in progress and disposal was requested.
            if (docRevision !== checkpointRevision) await autosave.flush();
            deps.onBanner(`Could not save the leave history version: ${userMessage(e)} The note may already be saved.`);
            throw e;
          }
          if (docRevision === checkpointRevision) break;
          await autosave.flush();
        }
      })();
      // Return the finalized promise itself so catching leave() also handles
      // failures from its cleanup chain.
      return run.finally(finishOperation);
    },
    /** Stops autosave after any flushes and leaves in progress finish. */
    dispose() {
      disposeRequested = true;
      if (activeOperations === 0) autosave.dispose();
    },
  };
}
export type NoteSession = ReturnType<typeof createNoteSession>;
