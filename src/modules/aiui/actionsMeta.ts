/**
 * How each AI action looks on the action sheet: icon and one-line
 * description. Labels come from P3a's ACTION_DEFS so engine and screen
 * never disagree on a name.
 */
import type { IconName } from '@/core/ui';
import { ACTION_DEFS, type AiActionId } from '@/modules/ai';

import { ta, type AiStringKey } from './strings';

const META: Record<AiActionId, { icon: IconName; desc: AiStringKey }> = {
  beautify: { icon: 'color-wand-outline', desc: 'ai.action.beautify' },
  summarize: { icon: 'list-outline', desc: 'ai.action.summarize' },
  explain: { icon: 'bulb-outline', desc: 'ai.action.explain' },
  flashcards: { icon: 'albums-outline', desc: 'ai.action.flashcards' },
  quiz: { icon: 'help-circle-outline', desc: 'ai.action.quiz' },
  cleanTranscript: { icon: 'mic-outline', desc: 'ai.action.cleanTranscript' },
  clarify: { icon: 'sparkles-outline', desc: 'ai.action.clarify' },
  simplify: { icon: 'leaf-outline', desc: 'ai.action.simplify' },
  translate: { icon: 'language-outline', desc: 'ai.action.translate' },
  expand: { icon: 'add-circle-outline', desc: 'ai.action.expand' },
  keyTerms: { icon: 'key-outline', desc: 'ai.action.keyTerms' },
};

export function actionMeta(id: AiActionId): { label: string; icon: IconName; description: string } {
  return { label: ACTION_DEFS[id].label, icon: META[id].icon, description: ta(META[id].desc) };
}
