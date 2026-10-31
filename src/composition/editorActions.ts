/**
 * Runs editor actions (see modules/editor/actions.ts) and holds the built-in
 * Beautify Lite action. One path for every action: flush, run, validate,
 * version, save, undo.
 */
import { AppError, prepareDocForSave, type IdGenerator, type NoteDoc } from '@/core';
import { beautifyLite, type BeautifyReport } from '@/modules/beautify';
import type { EditorAction, EditorHost } from '@/modules/editor';
import type { Store } from '@/modules/store';

export function beautifyMessage(r: BeautifyReport): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n && parts.push(`${n} ${n === 1 ? one : many}`);
  add(r.headings, 'heading', 'headings');
  add(r.definitions, 'definition', 'definitions');
  add(r.lists, 'list', 'lists');
  add(r.callouts, 'callout', 'callouts');
  add(r.qa, 'Q&A', 'Q&As');
  add(r.highlights, 'highlight', 'highlights');
  return parts.length ? `Beautified: ${parts.join(', ')}` : 'Beautified';
}

/** Beautify Lite as an editor action (on device, no key, works offline). */
export const beautifyLiteAction: EditorAction = {
  id: 'beautify-lite',
  label: 'Beautify',
  icon: 'color-wand-outline',
  placement: 'toolbar',
  reason: 'before_beautify',
  async run(ctx) {
    const { doc, report } = beautifyLite(ctx.doc, ctx.ids);
    return report.changed ? { doc, message: beautifyMessage(report) } : null;
  },
};

export interface ActionOutcome {
  message: string;
  /** Restores the exact document from before the action (same block ids). */
  undo(): Promise<void>;
}

/**
 * Runs an action against a note. Returns null when the action changed
 * nothing or was cancelled. Throws AppError on invalid output (nothing saved).
 */
export async function runEditorAction(
  action: EditorAction,
  deps: { store: Store; ids: IdGenerator; host: EditorHost },
  noteId: string,
): Promise<ActionOutcome | null> {
  const { store, ids, host } = deps;
  const note = await store.notes.get(noteId);
  if (!note || note.deleted) throw new AppError('not_found', 'This note no longer exists.');
  const before: NoteDoc = await host.getDocument();
  const selection = await host.getSelection();
  const result = await action.run({
    noteId,
    subjectId: note.subject,
    title: note.title,
    stylePackId: note.stylePackId,
    doc: before,
    selection,
    ids,
  });
  if (!result) return null;
  const prepared = prepareDocForSave(result.doc, ids); // schema + ids + cloud caps; throws nothing
  if (!prepared.ok) throw prepared.error;
  // The host's document may hold edits not yet autosaved: store them first so the
  // version below is exactly what the student saw.
  if (JSON.stringify(before) !== JSON.stringify(note.document)) await store.notes.save(noteId, { document: before });
  await store.notes.save(noteId, { document: prepared.value.doc }, { before: action.reason });
  host.showDocument(prepared.value.doc);
  return {
    message: result.message,
    async undo() {
      await store.notes.save(noteId, { document: before });
      host.showDocument(before);
    },
  };
}
