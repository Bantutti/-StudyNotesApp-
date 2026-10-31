/**
 * Editor action hook (the documented extension point for P3b).
 *
 * An EditorAction is anything that proposes a new version of the note:
 * Beautify Lite now, the AI actions (sparkle button) in P3b. The editor
 * screen shows registered actions in their placement and runs them through
 * one path (composition `runEditorAction`), which:
 *   1. asks the host for the CURRENT document (the editor flushes first),
 *   2. calls action.run(ctx) -> a proposed document or null (cancelled),
 *   3. validates it with the note schema and the cloud caps,
 *   4. saves a version with the action's reason ("before_beautify",
 *      "before_ai"), then saves the new document in the same transaction,
 *   5. returns an undo that restores the exact previous document (same
 *      block ids) for the snackbar.
 * Actions never touch storage or the WebView themselves.
 *
 * P3b: register with `services.editorActions.register({...})`, placement
 * 'sparkle'; show your own preview UI inside run() (diff, accept per block)
 * and resolve with the accepted document, or null to cancel.
 */
import type { IdGenerator, NoteDoc } from '@/core';

export type EditorActionPlacement = 'toolbar' | 'sparkle' | 'menu';
export type EditorActionReason = 'before_beautify' | 'before_ai';

export interface EditorActionContext {
  noteId: string;
  subjectId: string | null;
  title: string;
  stylePackId: string;
  /** The current document, flushed from the editor. */
  doc: NoteDoc;
  /** Block ids of the selection, or null for the whole note (selection arrives with M5's editor). */
  selection: readonly string[] | null;
  ids: IdGenerator;
  signal?: AbortSignal;
}

export interface EditorActionResult {
  doc: NoteDoc;
  /** Short message for the Undo snackbar, e.g. "Beautified: 3 headings, 2 definitions". */
  message: string;
}

export interface EditorAction {
  /** Stable id, e.g. "beautify-lite", "ai-summarize". */
  id: string;
  label: string;
  /** Ionicons name. */
  icon: string;
  placement: EditorActionPlacement;
  reason: EditorActionReason;
  isAvailable?(ctx: Omit<EditorActionContext, 'doc' | 'ids' | 'signal'>): boolean;
  /** Proposed document, or null when the user cancelled / nothing to change. */
  run(ctx: EditorActionContext): Promise<EditorActionResult | null>;
}

/** What the screen hosting the note provides to actions. */
export interface EditorHost {
  getDocument(): Promise<NoteDoc>;
  getSelection(): Promise<readonly string[] | null>;
  /** Shows a new document after an action or an undo (the editor reloads it). */
  showDocument(doc: NoteDoc): void;
}

export interface EditorActionRegistry {
  register(action: EditorAction): () => void;
  list(placement?: EditorActionPlacement): EditorAction[];
  get(id: string): EditorAction | undefined;
}

const ACTION_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function createEditorActionRegistry(initial: readonly EditorAction[] = []): EditorActionRegistry {
  const actions = new Map<string, EditorAction>();
  const reg: EditorActionRegistry = {
    register(a) {
      if (!ACTION_ID.test(a.id)) throw new Error(`bad_action_id:${a.id}`);
      if (actions.has(a.id)) throw new Error(`duplicate_action:${a.id}`);
      actions.set(a.id, a);
      return () => {
        actions.delete(a.id);
      };
    },
    list: (placement) => [...actions.values()].filter((a) => !placement || a.placement === placement),
    get: (id) => actions.get(id),
  };
  initial.forEach((a) => reg.register(a));
  return reg;
}
