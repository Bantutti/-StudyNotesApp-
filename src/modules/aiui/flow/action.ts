/**
 * The "AI" editor action (sparkle slot in P1's keyboard toolbar).
 *
 * It goes through P1's documented hook (src/modules/editor/actions.ts), not
 * the editor's internals: run() opens the AI flow and resolves with the
 * accepted document. P1's runEditorAction then validates it, saves the
 * "Before AI change" version, saves the note and offers exact Undo.
 */
import type { EditorAction } from '@/modules/editor';

import type { AiFlow } from './controller';

export const AI_ACTION_ID = 'ai';

export function createAiEditorAction(deps: {
  flow: AiFlow;
  /**
   * The subject's "AI allowed" switch (Plan F5 "Never send this subject to
   * AI"). Must fail closed: return false if the subject can't be read.
   */
  subjectAiAllowed: (subjectId: string | null) => Promise<boolean>;
}): EditorAction {
  return {
    id: AI_ACTION_ID,
    label: 'AI',
    icon: 'sparkles-outline',
    placement: 'sparkle',
    reason: 'before_ai',
    async run(ctx) {
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
