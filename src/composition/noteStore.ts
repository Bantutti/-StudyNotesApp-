import type { NoteDoc } from '@/core';
import { SAMPLE_NOTE, SAMPLE_NOTE_TITLE } from '@/core';

/**
 * In-memory "current note" shared by the editor and export spikes.
 * P0 has no persistence on purpose; SQLite storage arrives in P1.
 */
export interface NoteStore {
  get(): { doc: NoteDoc; title: string; isSample: boolean };
  set(doc: NoteDoc): void;
  reset(): void;
  subscribe(fn: () => void): () => void;
}

export function createNoteStore(): NoteStore {
  let state = { doc: SAMPLE_NOTE, title: SAMPLE_NOTE_TITLE, isSample: true };
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());
  return {
    get: () => state,
    set(doc) {
      state = { doc, title: 'Edited note', isSample: false };
      emit();
    },
    reset() {
      state = { doc: SAMPLE_NOTE, title: SAMPLE_NOTE_TITLE, isSample: true };
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
