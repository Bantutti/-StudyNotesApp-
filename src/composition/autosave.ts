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
  let firstPendingAt = 0;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let changed = false;
  let disposed = false;

  const run = async (): Promise<void> => {
    if (timer !== null) clearT(timer);
    timer = null;
    if (inFlight) {
      await inFlight;
      if (pending) return run();
      return;
    }
    if (!pending || disposed) return;
    const doc = pending;
    pending = null;
    firstPendingAt = 0;
    inFlight = (async () => {
      try {
        await deps.checkpoint();
        const r = await deps.save(doc);
        changed = true;
        deps.onSaved?.(r);
      } catch (e) {
        if (!pending) {
          pending = doc; // keep it for the retry
          firstPendingAt = now();
        }
        deps.onError?.(e);
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
    if (pending && timer === null && !disposed) schedule();
  };

  const schedule = () => {
    if (timer !== null) clearT(timer);
    const waited = now() - firstPendingAt;
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
      if (!firstPendingAt) firstPendingAt = now();
      schedule();
    },
    /** Saves now (and waits for any save in flight). */
    flush: (): Promise<void> => run(),
    /** A document shown by an action, undo or restore is already stored: drop pending changes. */
    reset() {
      if (timer !== null) clearT(timer);
      timer = null;
      pending = null;
      firstPendingAt = 0;
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
