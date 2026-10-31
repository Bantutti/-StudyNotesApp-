/**
 * Prompt assembly. The note is passed as delimited, escaped, untrusted data
 * (Plan §14): one JSON object per block, with '<', '>' and '&' written as
 * \u003c, \u003e, \u0026 so note text can never close the <note_blocks> tag.
 */
import type { Unit } from '../document/units';
import { PROMPT_BASE, type ActionDef } from './registry';

/** Re-ask note added after an invalid answer (Rey Nov 1, Q6 = A: one re-ask). */
export const REASK_NOTE =
  'Your previous answer was rejected because it did not match the required JSON schema or used refs that are not in the note. Answer again with valid JSON only, using only refs from the note.';

/** JSON line for one unit (aliases only; never the real block id). */
export function unitLine(u: Unit): string {
  const json = JSON.stringify({ ref: u.alias, kind: u.kind, term: u.term, text: u.text, readOnly: u.readOnly, depth: u.depth });
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function buildSystemPrompt(action: ActionDef): string {
  return `${PROMPT_BASE}\n\n${action.task}`;
}

export function buildUserPrompt(action: ActionDef, chunk: readonly Unit[], part: { index: number; total: number }, reask: boolean): string {
  const lines = [
    `Action: ${action.label}.${part.total > 1 ? ` This is part ${part.index + 1} of ${part.total} of the note.` : ''}`,
    '<note_blocks>',
    ...chunk.map(unitLine),
    '</note_blocks>',
  ];
  if (reask) lines.push(REASK_NOTE);
  return lines.join('\n');
}
