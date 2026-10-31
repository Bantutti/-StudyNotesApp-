/**
 * Proposal model: what an AI action suggests, before anything changes.
 * P3b renders `changes` as the per-block diff with accept toggles (Flow 4).
 */
import type { DocNode, NoteDoc } from '@/core';

import type { AiActionId } from '../actions/registry';
import type { Provider } from '../keyFormat';

export type ChangeKind = 'replace' | 'delete' | 'insert';

export interface BlockChange {
  /** Stable within the proposal ("c1", "c2", ...). */
  changeId: string;
  kind: ChangeKind;
  /** replace/delete: the block being changed. */
  targetId: string | null;
  /** insert: new nodes go right after this block (in its parent), null = start of note. */
  afterId: string | null;
  /** replace/delete: snapshot of the block when the proposal was made (stale check, §6.1). */
  before: DocNode | null;
  /** replace/insert: the new nodes. New blocks carry no id until applied. */
  after: DocNode[];
  /** True for content the AI added rather than rewrote (shown with an "AI-added" tag). */
  aiAdded: boolean;
  /** Existing block ids that disappear if this change is accepted (§4.3). */
  removesIds: string[];
}

/** A flashcard draft in P2a's card fields (firebase cardSchema). P4c saves it. */
export interface CardDraft {
  type: 'basic' | 'reversed' | 'cloze';
  front: string;
  back: string;
  source: 'ai';
  sourceBlockId: string;
}

export interface QuizDraft {
  kind: 'mcq' | 'short';
  question: string;
  choices: string[];
  answerIndex: number | null;
  answer: string;
  sourceBlockId: string;
}

export interface ProposalUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

export interface Proposal {
  id: string;
  action: AiActionId;
  provider: Provider;
  /** Every model that answered (a fallback model may appear). */
  models: string[];
  promptVersion: string;
  createdAt: number;
  /** Canonical JSON of the note the proposal was computed from. */
  baseDocJson: string;
  /** Ids of the blocks that were sent (P3b can say "3 blocks were sent"). */
  sentBlockIds: string[];
  changes: BlockChange[];
  cards: CardDraft[];
  quiz: QuizDraft[];
  /** Machine codes for things the user should know, e.g. "nothing_found". */
  warnings: string[];
  /** Label for the version-history snapshot taken before applying (F14). */
  snapshotReason: string;
  usage: ProposalUsage;
}

/** What applyProposal returns. */
export interface ApplyResult {
  doc: NoteDoc;
  undo: UndoRecord;
  appliedChangeIds: string[];
  /** Accepted changes that were skipped because the note changed (§6.1). */
  staleChangeIds: string[];
  /** Existing blocks whose content changed (P4c marks their cards "Source changed"). */
  changedBlockIds: string[];
  newBlockIds: string[];
  removedBlockIds: string[];
}

/** Exact undo (ALGORITHMS §7): valid only while the note is unchanged since apply. */
export interface UndoRecord {
  proposalId: string;
  beforeJson: string;
  afterJson: string;
  snapshotReason: string;
}
