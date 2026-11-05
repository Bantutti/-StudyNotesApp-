/**
 * Autosave for the editor (plan: "saves as you type", no Save button).
 *
 * - Saves 1 s after the last change, and at least every 5 s while the
 *   student keeps typing (so a crash loses at most a few seconds).
 * - flush() saves immediately: the app goes to the background, the student
 *   leaves the note, or an editor action needs the stored text first.
 * - One save at a time; changes during a save are saved right after it.
 * - Before each save, `checkpoint()` runs the version rule "every 10
 *   minutes of editing" (versions.ts), so History keeps the text as it was.
 * - A failed save keeps the change pending and reports the error; the next
 *   change or flush retries.
 */
import type { NoteDoc } from '@/core';
import type { SaveResult } from '@/modules/store';

export const AUTOSAVE_DEBOUNCE_MS = 1_000;
export const AUTOSAVE_MAX_WAIT_MS = 5_000;

export interface AutosaveDeps {
  save(doc: NoteDoc): Promise<SaveResult>;
  checkpoint(): Promise<unknown>;
  onSaved?(r: SaveResult): void;
  onError?(e: unknown): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  debounceMs?: number;
  maxWaitMs?: number;
}

export function createAutosave(deps: AutosaveDeps) {
  const now = deps.now ?? Date.now;
  const setT = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const debounce = deps.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const maxWait = deps.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS;

  let pending: NoteDoc | null = null;
  let firstPendingAt: number | null = null;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let changed = false;
  let disposed = false;
  let editRevision = 0;
  let resetRevision = 0;
  let retryPaused = false;
  const currentInFlight = () => inFlight;

  const run = async (explicit = false): Promise<void> => {
    if (timer !== null) clearT(timer);
    timer = null;
    if (inFlight) {
      await inFlight;
      // A timer waiting on a failed attempt must not silently retry it. A
      // fresh edit or an explicit flush may still request another attempt.
      // Another waiter may already have moved the pending edit into a new
      // in-flight save. A flush must wait for that save as well.
      if (currentInFlight() || (pending && (explicit || !retryPaused))) return run(explicit);
      return;
    }
    if (!pending || disposed || (retryPaused && !explicit)) return;
    const doc = pending;
    const attemptedEdit = editRevision;
    const attemptedReset = resetRevision;
    pending = null;
    firstPendingAt = null;
    retryPaused = false;
    // Start in a microtask so inFlight is assigned before even a synchronous
    // exception from a dependency can reach the cleanup below.
    inFlight = Promise.resolve().then(async () => {
      try {
        await deps.checkpoint();
        const r = await deps.save(doc);
        changed = true;
        deps.onSaved?.(r);
      } catch (e) {
        // Prefer a newer edit, and do not resurrect a document that reset()
        // explicitly replaced while this attempt was in flight.
        if (!pending && attemptedReset === resetRevision) {
          pending = doc;
          firstPendingAt = now();
        }
        // A new edit during the attempt permits one more automatic save;
        // otherwise retain the document without scheduling a retry loop.
        retryPaused = pending !== null && editRevision === attemptedEdit;
        deps.onError?.(e);
      } finally {
        inFlight = null;
      }
    });
    await inFlight;
    // A flush/leave must include edits that arrived during its save; otherwise
    // disposal immediately after flush could cancel their scheduled timer.
    if (explicit && pending && !retryPaused && !disposed) return run(true);
    if (pending && !retryPaused && timer === null && !disposed) schedule();
  };

  const schedule = () => {
    if (timer !== null) clearT(timer);
    const waited = now() - (firstPendingAt ?? now());
    timer = setT(() => {
      timer = null;
      void run();
    }, Math.max(0, Math.min(debounce, maxWait - waited)));
  };

  return {
    /** The editor reported a new document. */
    change(doc: NoteDoc) {
      if (disposed) return;
      pending = doc;
      editRevision++;
      // A paused failure may be arbitrarily old; debounce from this new edit.
      if (retryPaused || firstPendingAt === null) firstPendingAt = now();
      retryPaused = false;
      schedule();
    },
    /** Saves now (and waits for any save in flight). */
    flush: (): Promise<void> => run(true),
    /** A document shown by an action, undo or restore is already stored: drop pending changes. */
    reset() {
      resetRevision++;
      retryPaused = false;
      if (timer !== null) clearT(timer);
      timer = null;
      pending = null;
      firstPendingAt = null;
    },
    get hasPending() {
      return pending !== null;
    },
    /** True once something was saved in this editing session (for the "leave" version). */
    get changedThisSession() {
      return changed;
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearT(timer);
      timer = null;
    },
  };
}
export type Autosave = ReturnType<typeof createAutosave>;
