/**
 * The "AI" editor action (sparkle slot in P1's keyboard toolbar).
 *
 * It goes through P1's documented hook (src/modules/editor/actions.ts), not
 * the editor's internals: run() opens the AI flow and resolves with the
 * accepted document. P1's runEditorAction then validates it, saves the
 * "Before AI change" version, saves the note and offers exact Undo.
 */
import { AppError, extractTextBlocks, type NoteDoc } from '@/core';
import type { EditorAction } from '@/modules/editor';

import { ta } from '../strings';
import type { AiFlow } from './controller';

/** True when a document holds any text (headings, lines, terms). */
export function docHasText(doc: NoteDoc | null | undefined): boolean {
  return !!doc && Array.isArray(doc.content) && doc.content.length > 0 && extractTextBlocks(doc).length > 0;
}

export const AI_ACTION_ID = 'ai';

export function createAiEditorAction(deps: {
  flow: AiFlow;
  /**
   * The subject's "AI allowed" switch (Plan F5 "Never send this subject to
   * AI"). Must fail closed: return false if the subject can't be read.
   */
  subjectAiAllowed: (subjectId: string | null) => Promise<boolean>;
  /**
   * Whether the STORED note has text. Guard for P1's known bug (Lead, Nov 1):
   * the editor can hand over an empty document when the live one fails
   * validation. Then the AI must not run (and nothing may be saved).
   */
  storedNoteHasText: (noteId: string) => Promise<boolean>;
}): EditorAction {
  return {
    id: AI_ACTION_ID,
    label: 'AI',
    icon: 'sparkles-outline',
    placement: 'sparkle',
    reason: 'before_ai',
    async run(ctx) {
      // Empty hand-over while the stored note has text: refuse before anything opens or is sent.
      if (!docHasText(ctx.doc)) {
        let stored = true; // fail closed: if the stored note can't be read, assume it has text
        try {
          stored = await deps.storedNoteHasText(ctx.noteId);
        } catch {
          stored = true;
        }
        if (stored) throw new AppError('validation_failed', ta('ai.guard.emptyDoc'));
      }
      let allowed = false;
      try {
        allowed = await deps.subjectAiAllowed(ctx.subjectId);
      } catch {
        allowed = false; // stricter option when unsure (build rules §1)
      }
      return deps.flow.start(ctx, allowed);
    },
  };
}
