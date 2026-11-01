/**
 * Turns a Proposal into the rows the diff preview shows (Plan Flow 4:
 * per-block before and after with accept toggles).
 *
 * - Every change starts ACCEPTED, except stale ones (the block changed since
 *   the AI saw it; P3a Q7 = A), which start off and cannot be turned on.
 * - Text is plain (§2.4) and diffed by words (§2).
 */
import type { NoteDoc } from '@/core';
import { findStaleChanges, type BlockChange, type Proposal } from '@/modules/ai';

import { blockView, nodesView } from './blockText';
import { wordDiff, type DiffSegment } from './wordDiff';

export interface DiffRow {
  changeId: string;
  kind: BlockChange['kind'];
  /** Kind label of the result ("Heading 2", "Definition", "Removed"). */
  label: string;
  /** Content the AI added rather than rewrote (Expand, Summary, Key terms, Explain). */
  aiAdded: boolean;
  stale: boolean;
  beforeText: string;
  afterText: string;
  /** Word diff covering both sides (replace only; inserts are all "added", deletes all "removed"). */
  segments: DiffSegment[];
}

export function buildDiffRows(currentDoc: NoteDoc, proposal: Proposal): DiffRow[] {
  const stale = new Set(findStaleChanges(currentDoc, proposal));
  return proposal.changes.map((c) => {
    const before = c.before ? blockView(c.before) : null;
    const after = nodesView(c.after);
    const beforeText = before?.text ?? '';
    const afterText = c.kind === 'delete' ? '' : after.text;
    let segments: DiffSegment[];
    if (c.kind === 'insert') segments = [{ kind: 'added', text: afterText }];
    else if (c.kind === 'delete') segments = [{ kind: 'removed', text: beforeText }];
    else segments = wordDiff(beforeText, afterText);
    return {
      changeId: c.changeId,
      kind: c.kind,
      label: c.kind === 'delete' ? 'Removed' : after.label,
      aiAdded: c.aiAdded,
      stale: stale.has(c.changeId),
      beforeText,
      afterText,
      segments,
    };
  });
}

/** The accept set a preview opens with: everything except stale changes. */
export function initialAccepted(rows: readonly DiffRow[]): Set<string> {
  return new Set(rows.filter((r) => !r.stale).map((r) => r.changeId));
}
