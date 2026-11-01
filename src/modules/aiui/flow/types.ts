/**
 * Flow state shown by the AI screens (ALGORITHMS §3). The controller owns
 * it; components only read snapshots and call controller methods.
 *
 * Never in here: the key the student types, their birth year, or the note
 * text beyond what the proposal rows show on screen (§3.3).
 */
import type { AiActionId, AiErrorKind, Provider, RunProgress } from '@/modules/ai';

import type { DiffRow } from '../diff/viewModel';

/** One next step per error (Plan §9.6: "give one next step"). */
export type NextStep = 'retry' | 'replace_key' | 'switch_provider' | 'beautify_lite' | 'select_part' | 'ok';

export interface ErrorView {
  kind: AiErrorKind | 'unknown';
  /** Already names the provider (P3a aiMessage). Safe to show: no content, no key. */
  message: string;
  next: NextStep;
  /** The other provider the student could switch to (has a key), for switch_provider. */
  switchTo: Provider | null;
}

/** Short notices shown on the action sheet after something didn't go ahead. */
export type Notice = 'cancelled' | 'not_sent' | 'discarded' | null;

export type FlowStep =
  | { name: 'closed' }
  /** The note's subject has "Never send this subject to AI" on. */
  | { name: 'blocked' }
  /** The student answered the age check as under 18 (§1). Calm, no nagging. */
  | { name: 'minor'; recheckAvailable: boolean }
  | { name: 'actions'; notice: Notice }
  | { name: 'age' }
  | { name: 'key'; provider: Provider; replacing: boolean }
  | { name: 'consent'; provider: Provider }
  | { name: 'running'; progress: RunProgress | null }
  | { name: 'preview' }
  /** The AI answered but proposed nothing (e.g. "nothing_found"). */
  | { name: 'empty' }
  | { name: 'error'; error: ErrorView }
  | { name: 'report'; from: 'preview' | 'empty' };

export type ScopeChoice = 'selection' | 'note';

export interface ProviderStatus {
  id: Provider;
  label: string;
  hasKey: boolean;
}

export interface ProposalSummary {
  action: AiActionId;
  provider: Provider;
  models: string[];
  promptVersion: string;
  /** How many blocks were sent ("3 blocks were sent to Groq"). */
  sentBlocks: number;
  warnings: string[];
}

export interface FlowSnapshot {
  step: FlowStep;
  /** The action the student picked (kept while gates are answered). */
  action: AiActionId | null;
  provider: Provider;
  providers: ProviderStatus[];
  scope: ScopeChoice;
  /** True when the editor reported a selection (Explain needs one). */
  hasSelection: boolean;
  /** Usage today for the chosen provider, or null while loading. */
  usage: UsageLine | null;
  rows: DiffRow[];
  accepted: ReadonlySet<string>;
  proposal: ProposalSummary | null;
  /** Development "Demo AI" mode: fake answers, nothing leaves the phone. Labelled on screen. */
  demo: boolean;
  /** A request (apply, consent, key save) is in progress; buttons are disabled. */
  busy: boolean;
  /** The student saved a local report for the current result. */
  reported: boolean;
}

/** §4.1 "N of L today". */
export interface UsageLine {
  provider: Provider;
  requests: number;
  /** Published requests/day for the primary model, or null (unpublished). */
  dailyLimit: number | null;
  /** The provider's own "requests left today" header, when it sent one. */
  remaining: number | null;
  checkedOn: string;
}

export type SaveKeyResult =
  | { kind: 'saved' }
  | { kind: 'bad_format'; message: string }
  | { kind: 'rejected' }
  /** The key could not be checked (offline, timeout, provider down). The student may save it anyway. */
  | { kind: 'unchecked'; message: string };
