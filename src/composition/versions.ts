/**
 * Version history rules (plan F14, decision Q9 = A).
 *
 * A version is saved:
 *  - before Beautify, an AI change, a style-pack switch, applying a template
 *    and a restore (the caller passes `before:` to store.notes.save, or the
 *    editor action hook does it),
 *  - every 10 minutes of editing (checkpointWhileEditing, called by the
 *    editor's autosave BEFORE it stores the new text: finish wiring in M5),
 *  - when the student leaves a note they changed (checkpointOnLeave: M5).
 * Duplicates are skipped, the newest 20 are kept, versions stay on the
 * phone and are wiped with their note.
 */
import type { Store, VersionReason } from '@/modules/store';

export const EDIT_CHECKPOINT_MS = 10 * 60 * 1000;

/** Saves the stored state as an "edit" version if the last version is 10+ minutes old. */
export async function checkpointWhileEditing(store: Store, noteId: string, now: number): Promise<boolean> {
  const last = await store.versions.latestAt(noteId);
  if (last !== 0 && now - last < EDIT_CHECKPOINT_MS) return false;
  return (await store.versions.snapshot(noteId, 'edit')) !== null;
}

/** Saves a "leave" version when the student leaves a note they changed (deduplicated). */
export async function checkpointOnLeave(store: Store, noteId: string, changed: boolean): Promise<boolean> {
  if (!changed) return false;
  return (await store.versions.snapshot(noteId, 'leave')) !== null;
}

const LABELS: Record<VersionReason, string> = {
  edit: 'While editing',
  leave: 'When you left the note',
  before_beautify: 'Before Beautify',
  before_pack: 'Before style change',
  before_template: 'Before template',
  before_restore: 'Before restore',
  before_ai: 'Before AI change',
  before_sync_merge: 'Before sync merge',
};

export const versionLabel = (r: VersionReason): string => LABELS[r];
