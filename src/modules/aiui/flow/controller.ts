/**
 * The AI flow controller: a plain state machine (no React) behind the AI
 * screens. ALGORITHMS §3; Plan Flow 4.
 *
 *   sparkle -> start(ctx) -> action sheet -> [age] -> [key] -> [consent]
 *           -> running (Cancel) -> preview (toggles) -> apply -> resolve(doc)
 *
 * start() returns a promise that settles exactly once (§3.2):
 * - resolves with { doc, message } after Apply. P1's runEditorAction then
 *   validates it, saves the "Before AI change" version, saves the new note
 *   and shows the 8-second Undo, which restores the exact previous document.
 * - rejects with AppError('cancelled') for every other ending (Close, Cancel,
 *   Discard, back gesture). The note screen shows nothing for that code.
 *
 * Secrets: a typed key passes through saveKey() as an argument only and is
 * never kept in the snapshot or logged. The birth year never reaches this
 * file (the age screen sends only the RESULT, §1.1).
 */
import { AppError, type IdGenerator, type Logger, type NoteDoc } from '@/core';
import {
  ACTION_DEFS,
  AiError,
  applyProposal,
  isAiError,
  PROVIDER_CATALOG,
  PROVIDERS,
  type AiActionId,
  type AiEngine,
  type KeyVault,
  type Proposal,
  type Provider,
} from '@/modules/ai';
import type { EditorActionContext, EditorActionResult } from '@/modules/editor';

import { buildDiffRows, initialAccepted } from '../diff/viewModel';
import type { GateStore } from '../gate/gateStore';
import type { NewReport, ReportReason, ReportsStore } from '../gate/reportsStore';
import { ta } from '../strings';
import { docHasText } from './action';
import { testAndSaveKey } from './keys';
import { errorView } from './messages';
import type { FlowSnapshot, FlowStep, ProviderStatus, SaveKeyResult, ScopeChoice, UsageLine } from './types';

/**
 * Flashcards and Quiz me are built in the engine but stay hidden until P4c
 * adds the card list and quiz screens that can save them (Q5 = B: moved to
 * P4c, not cut).
 */
export const AI_CARDS_ENABLED = false;

/** Order on the action sheet (Plan Flow 4 first, then the rest of F5). */
export const ACTION_ORDER: readonly AiActionId[] = [
  'beautify',
  'summarize',
  'explain',
  'flashcards',
  'quiz',
  'cleanTranscript',
  'clarify',
  'simplify',
  'translate',
  'expand',
  'keyTerms',
];

/** Actions the sheet shows (cards and quiz hidden until P4c). */
export function visibleActions(): AiActionId[] {
  return ACTION_ORDER.filter((id) => AI_CARDS_ENABLED || (ACTION_DEFS[id].kind !== 'cards' && ACTION_DEFS[id].kind !== 'quiz'));
}

export interface AiFlowDeps {
  /** The real engine, or the Demo AI engine in development builds (chosen per run). */
  engine: () => Promise<AiEngine>;
  /** True when engine() currently returns the Demo AI (shown on every screen). */
  isDemo: () => Promise<boolean>;
  gate: GateStore;
  keyVault: KeyVault;
  reports: ReportsStore;
  ids: IdGenerator;
  logger: Logger;
}

export interface AiFlow {
  /** Opens the flow for one note. Only one flow at a time. */
  start(ctx: EditorActionContext, aiAllowed: boolean): Promise<EditorActionResult>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): FlowSnapshot;

  chooseAction(id: AiActionId): Promise<void>;
  setScope(scope: ScopeChoice): void;
  setProvider(p: Provider): Promise<void>;
  /** The age screen reports only the RESULT (§1.1). */
  answerAge(adult: boolean): Promise<void>;
  /** Minor panel: start the age check again once re-check is available (§1.4). */
  recheckAge(): Promise<void>;
  /** Opens the key wizard for a provider (from the provider chip or an error). */
  openKey(p: Provider, replacing: boolean): Promise<void>;
  /** Tests then stores a pasted key. `force` saves without a check (offline case). */
  saveKey(p: Provider, raw: string, force?: boolean): Promise<SaveKeyResult>;
  answerConsent(yes: boolean): Promise<void>;
  cancelRun(): void;
  toggle(changeId: string): void;
  acceptAll(on: boolean): void;
  apply(): Promise<void>;
  discard(): void;
  /** Runs the error's next step (Retry, Replace key, Switch provider, ...). */
  nextStep(): Promise<void>;
  openReport(): void;
  submitReport(reason: ReportReason, comment: string): Promise<void>;
  closeReport(): void;
  /** Back to the action sheet from a gate step. */
  back(): void;
  /** Closes the modal from any step: settles start() as cancelled. */
  close(): void;
}

interface Pending {
  ctx: EditorActionContext;
  aiAllowed: boolean;
  resolve(r: EditorActionResult): void;
  reject(e: unknown): void;
}

const CLOSED: FlowStep = { name: 'closed' };

export function createAiFlow(deps: AiFlowDeps): AiFlow {
  const log = deps.logger.child('ai_flow');
  const listeners = new Set<() => void>();
  let pending: Pending | null = null;
  let proposal: Proposal | null = null;
  let run: AbortController | null = null;
  /** Bumped on every start/close so late async results from an old flow are ignored. */
  let generation = 0;
  let snap: FlowSnapshot = {
    step: CLOSED,
    action: null,
    provider: 'groq',
    providers: [],
    scope: 'note',
    hasSelection: false,
    usage: null,
    rows: [],
    accepted: new Set(),
    proposal: null,
    demo: false,
    busy: false,
    reported: false,
  };

  const set = (patch: Partial<FlowSnapshot>) => {
    snap = { ...snap, ...patch };
    listeners.forEach((l) => l());
  };
  const go = (step: FlowStep) => set({ step, busy: false });

  /** Settles start() once and resets everything (§3.2). */
  const settle = (outcome: { ok: true; value: EditorActionResult } | { ok: false }) => {
    const p = pending;
    pending = null;
    proposal = null;
    run?.abort();
    run = null;
    generation++;
    set({ step: CLOSED, action: null, rows: [], accepted: new Set(), proposal: null, usage: null, busy: false, reported: false });
    if (!p) return;
    if (outcome.ok) p.resolve(outcome.value);
    else p.reject(new AppError('cancelled', 'Cancelled. Nothing was changed.'));
  };

  const providerStatus = async (): Promise<ProviderStatus[]> =>
    Promise.all(PROVIDERS.map(async (id) => ({ id, label: PROVIDER_CATALOG[id].label, hasKey: await deps.keyVault.has(id) })));

  /** §4.1 usage line for the chosen provider. Never fails the flow. */
  const refreshUsage = async (gen: number) => {
    try {
      const engine = await deps.engine();
      const u = await engine.usage.today(snap.provider);
      if (gen !== generation) return;
      const primary = PROVIDER_CATALOG[snap.provider].models.primary;
      const line: UsageLine = {
        provider: snap.provider,
        requests: u.requests,
        dailyLimit: u.limits[primary]?.rpd ?? null,
        remaining: u.remainingRequests,
        checkedOn: u.limitsCheckedOn,
      };
      set({ usage: line });
    } catch {
      log.warn('usage_unavailable');
    }
  };

  /** The other provider that has a key, for "switch provider". */
  const otherKeyed = (p: Provider): Provider | null => snap.providers.find((x) => x.id !== p && x.hasKey)?.id ?? null;

  /**
   * §3.1 Walks the gates in order and stops at the first unmet one; when all
   * pass, runs the action. Called after every answer.
   */
  const advance = async (): Promise<void> => {
    const gen = generation;
    const p = pending;
    if (!p || !snap.action) return;
    const still = () => gen === generation && pending === p;
    set({ busy: true });
    if (!p.aiAllowed) return void (still() && go({ name: 'blocked' }));
    const age = await deps.gate.ageStatus();
    if (!still()) return;
    if (age.kind === 'unknown') return go({ name: 'age' });
    if (age.kind === 'minor') return go({ name: 'minor', recheckAvailable: age.recheckAvailable });
    const provider = snap.provider;
    if (!(await deps.keyVault.has(provider))) return void (still() && go({ name: 'key', provider, replacing: false }));
    const version = PROVIDER_CATALOG[provider].consent.version;
    if (!(await deps.gate.hasConsent(provider, version))) return void (still() && go({ name: 'consent', provider }));
    if (!still()) return;
    await execute(gen);
  };

  /** Sends the request (all gates passed) and shows the preview. */
  const execute = async (gen: number) => {
    const p = pending as Pending;
    const action = snap.action as AiActionId;
    const def = ACTION_DEFS[action];
    const useSelection = snap.scope === 'selection' && p.ctx.selection && p.ctx.selection.length > 0;
    const scope = useSelection ? { kind: 'blocks' as const, blockIds: [...(p.ctx.selection as readonly string[])] } : { kind: 'note' as const };
    if (def.needsSelection && scope.kind !== 'blocks') {
      // The sheet disables Explain without a selection; this is the guard behind it.
      return go({ name: 'error', error: errorView(new AiError('invalid_input', { reason: 'selection_required' }), null) });
    }
    const controller = new AbortController();
    run = controller;
    go({ name: 'running', progress: null });
    try {
      const engine = await deps.engine();
      const result = await engine.run(
        { action, provider: snap.provider, doc: p.ctx.doc, scope, aiAllowed: p.aiAllowed },
        { signal: controller.signal, onProgress: (progress) => gen === generation && set({ step: { name: 'running', progress } }) },
      );
      if (gen !== generation) return;
      run = null;
      proposal = result;
      const rows = buildDiffRows(p.ctx.doc, result);
      set({
        rows,
        reported: false,
        accepted: initialAccepted(rows),
        proposal: {
          action: result.action,
          provider: result.provider,
          models: result.models,
          promptVersion: result.promptVersion,
          sentBlocks: result.sentBlockIds.length,
          warnings: result.warnings,
        },
      });
      go(rows.length ? { name: 'preview' } : { name: 'empty' });
      void refreshUsage(gen);
    } catch (e) {
      if (gen !== generation) return;
      run = null;
      void refreshUsage(gen);
      await routeError(e);
    }
  };

  /** Gate errors from the engine go back to their step; others show the error panel. */
  const routeError = async (e: unknown) => {
    const kind = isAiError(e) ? e.kind : 'unknown';
    log.warn('run_failed', { kind });
    const provider = snap.provider;
    switch (kind) {
      case 'cancelled':
        return go({ name: 'actions', notice: 'cancelled' });
      case 'age_required':
        return go({ name: 'age' });
      case 'consent_required':
        return go({ name: 'consent', provider });
      case 'missing_key':
        return go({ name: 'key', provider, replacing: false });
      case 'blocked':
        return go({ name: 'blocked' });
      default:
        set({ providers: await providerStatus() });
        return go({ name: 'error', error: errorView(e, otherKeyed(provider)) });
    }
  };

  const flow: AiFlow = {
    async start(ctx, aiAllowed) {
      // One flow at a time (§3.2): a second tap while open is refused quietly.
      if (pending) throw new AppError('cancelled', 'The AI panel is already open.');
      generation++;
      const gen = generation;
      const promise = new Promise<EditorActionResult>((resolve, reject) => {
        pending = { ctx, aiAllowed, resolve, reject };
      });
      const hasSelection = !!ctx.selection && ctx.selection.length > 0;
      const [providers, preferred, age, demo] = await Promise.all([providerStatus(), deps.gate.defaultProvider(), deps.gate.ageStatus(), deps.isDemo()]);
      if (gen !== generation) return promise;
      // Default provider: the saved choice, else the first with a key, else Groq (P3a Q2).
      const provider = preferred ?? providers.find((x) => x.hasKey)?.id ?? 'groq';
      set({ providers, provider, demo, hasSelection, scope: hasSelection ? 'selection' : 'note', action: null, rows: [], accepted: new Set(), proposal: null });
      if (!aiAllowed) go({ name: 'blocked' });
      else if (age.kind === 'minor') go({ name: 'minor', recheckAvailable: age.recheckAvailable });
      else go({ name: 'actions', notice: null });
      void refreshUsage(gen);
      log.info('flow_open', { demo });
      return promise;
    },

    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getSnapshot: () => snap,

    async chooseAction(id) {
      if (!pending || snap.busy) return;
      if (!visibleActions().includes(id)) return; // hidden actions can't be started
      if (ACTION_DEFS[id].needsSelection && !(snap.hasSelection && snap.scope === 'selection')) return;
      set({ action: id });
      await advance();
    },

    setScope(scope) {
      if (scope === 'selection' && !snap.hasSelection) return;
      set({ scope });
    },

    async setProvider(p) {
      if (!pending) return;
      set({ provider: p, usage: null });
      try {
        await deps.gate.setDefaultProvider(p);
      } catch {
        log.warn('default_provider_not_saved');
      }
      void refreshUsage(generation);
    },

    async answerAge(adult) {
      if (!pending) return;
      set({ busy: true });
      await deps.gate.recordAge(adult); // only the result (§1.1)
      if (!adult) {
        const age = await deps.gate.ageStatus();
        return go({ name: 'minor', recheckAvailable: age.kind === 'minor' && age.recheckAvailable });
      }
      if (snap.action) await advance();
      else go({ name: 'actions', notice: null });
    },

    async recheckAge() {
      if (!pending) return;
      if (await deps.gate.clearAgeForRecheck()) go({ name: 'age' });
    },

    async openKey(p, replacing) {
      if (!pending) return;
      set({ provider: p });
      // The key wizard always comes after the 18+ check (security review P3b-S8).
      const age = await deps.gate.ageStatus();
      if (age.kind === 'unknown') return go({ name: 'age' });
      if (age.kind === 'minor') return go({ name: 'minor', recheckAvailable: age.recheckAvailable });
      go({ name: 'key', provider: p, replacing });
    },

    async saveKey(p, raw, force = false) {
      if (snap.busy) return { kind: 'unchecked', message: 'Please wait a moment.' };
      set({ busy: true });
      const engine = await deps.engine();
      const result = await testAndSaveKey({ engine, keyVault: deps.keyVault, logger: log }, p, raw, force);
      set({ busy: false });
      if (result.kind !== 'saved') return result;
      set({ providers: await providerStatus(), provider: p });
      if (!(await deps.gate.defaultProvider())) await deps.gate.setDefaultProvider(p).catch(() => undefined);
      // Continue the original action (Flow 4: "then continues the original action").
      if (pending && snap.action) await advance();
      else if (pending) go({ name: 'actions', notice: null });
      return result;
    },

    async answerConsent(yes) {
      if (!pending || snap.step.name !== 'consent') return;
      const provider = snap.step.provider;
      if (!yes) return go({ name: 'actions', notice: 'not_sent' });
      set({ busy: true });
      await deps.gate.giveConsent(provider, PROVIDER_CATALOG[provider].consent.version);
      await advance();
    },

    cancelRun() {
      run?.abort(); // the engine throws 'cancelled' -> back to the sheet with a notice
    },

    toggle(changeId) {
      const row = snap.rows.find((r) => r.changeId === changeId);
      if (!row || row.stale) return; // stale changes can't be turned on (P3a Q7)
      const next = new Set(snap.accepted);
      if (next.has(changeId)) next.delete(changeId);
      else next.add(changeId);
      set({ accepted: next });
    },

    acceptAll(on) {
      set({ accepted: on ? initialAccepted(snap.rows) : new Set() });
    },

    async apply() {
      const p = pending;
      if (!p || !proposal || snap.step.name !== 'preview' || snap.busy) return;
      if (snap.accepted.size === 0) return flow.discard();
      set({ busy: true });
      const r = applyProposal(p.ctx.doc, proposal, [...snap.accepted], deps.ids);
      if (!r.ok) {
        log.warn('apply_failed', { kind: isAiError(r.error) ? r.error.kind : 'unknown' });
        return go({ name: 'error', error: errorView(r.error, null) });
      }
      // Defensive: never hand back a note with no text when it had text (e.g. the AI
      // deleted every block). Nothing is saved; the student keeps the original.
      if (docHasText(p.ctx.doc) && !docHasText(r.value.doc)) {
        log.warn('apply_refused_empty');
        return go({ name: 'error', error: { kind: 'unknown', message: ta('ai.guard.emptyResult'), next: 'ok', switchTo: null } });
      }
      const n = r.value.appliedChangeIds.length;
      const label = ACTION_DEFS[proposal.action].label;
      const message = n === 1 ? `${label}: 1 change applied` : `${label}: ${n} changes applied`;
      log.info('applied', { action: proposal.action, changes: n, stale: r.value.staleChangeIds.length });
      settle({ ok: true, value: { doc: r.value.doc as NoteDoc, message } });
    },

    discard() {
      if (!pending) return;
      proposal = null;
      set({ rows: [], accepted: new Set(), proposal: null });
      go({ name: 'actions', notice: 'discarded' });
    },

    async nextStep() {
      if (!pending || snap.step.name !== 'error') return;
      const { next, switchTo } = snap.step.error;
      switch (next) {
        case 'retry':
          return advance();
        case 'replace_key':
          return flow.openKey(snap.provider, true);
        case 'switch_provider':
          if (switchTo) {
            await flow.setProvider(switchTo);
            return advance();
          }
          return go({ name: 'actions', notice: null });
        case 'beautify_lite':
        case 'select_part':
        case 'ok':
          return flow.close();
      }
    },

    openReport() {
      const from = snap.step.name === 'preview' ? 'preview' : snap.step.name === 'empty' ? 'empty' : null;
      if (!pending || !proposal || !from) return;
      go({ name: 'report', from });
    },

    async submitReport(reason, comment) {
      if (!pending || !proposal || snap.step.name !== 'report') return;
      const from = snap.step.from;
      const r: NewReport = {
        action: proposal.action,
        provider: proposal.provider,
        models: proposal.models.slice(0, 4),
        promptVersion: proposal.promptVersion,
        reason,
        comment,
      };
      set({ busy: true });
      await deps.reports.add(r); // local only; nothing is sent (Q10 = A)
      set({ reported: true });
      go({ name: from });
    },

    closeReport() {
      if (snap.step.name === 'report') go({ name: snap.step.from });
    },

    back() {
      if (!pending) return;
      run?.abort();
      go({ name: 'actions', notice: null });
    },

    close() {
      settle({ ok: false });
    },
  };
  return flow;
}
