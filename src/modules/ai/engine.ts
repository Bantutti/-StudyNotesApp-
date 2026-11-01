/**
 * The AI engine: run an action on a note and get back a Proposal.
 * Nothing in the note changes here; P3b shows the proposal as a diff and calls
 * applyProposal() for the blocks the student accepts (Plan Flow 4).
 *
 * Order of checks in run() (cheapest and most private first):
 *   action/provider valid -> subject AI switch -> 18+ confirmed -> provider
 *   consent -> key present -> online -> note valid with complete ids ->
 *   scope has text -> fits the free-tier budget -> send chunk by chunk.
 *
 * Per request: pacing under the model's TPM (§2), retries (§3), fallback to
 * the next model on a rate limit (Q3), one re-ask on an invalid answer (Q6),
 * and a usage record (Q8). Keys are read inside the adapter per request and
 * never pass through this file's variables.
 */
import * as z from 'zod';

import { validateNoteDoc, type IdGenerator, type Logger, type NoteDoc, type TextFilePort } from '@/core';

import { buildSystemPrompt, buildUserPrompt } from './actions/prompt';
import { ACTION_DEFS, isActionId, type ActionDef, type AiActionId } from './actions/registry';
import { toProviderSchema, type CardsOut, type EditPlan, type ExplainOut, type KeyTermsOut, type QuizOut, type SummaryOut } from './actions/schemas';
import { canonicalJson, hasCompleteIds } from './document/nodes';
import { chunkTokens, chunkUnits, estimateTokens } from './document/tokens';
import { extractUnits, type AiScope, type Unit } from './document/units';
import { AiError, isAiError, type AiErrorKind } from './errors';
import { isProvider, normalizeKey, type Provider } from './keyFormat';
import type { KeyVault } from './keyVault';
import {
  buildCards,
  buildEditChanges,
  buildExplainChange,
  buildKeyTermChanges,
  buildQuiz,
  buildSummaryChange,
  OutputRejected,
  type NewChange,
} from './proposal/build';
import type { CardDraft, Proposal, QuizDraft } from './proposal/types';
import { modelTpm, PROVIDER_CATALOG, providerModels, type ConsentKind, type ProviderInfo } from './providers/catalog';
import { createOpenAiCompatibleProvider, GROQ_CONFIG, MISTRAL_CONFIG } from './providers/openaiCompatible';
import type { ChatProvider, ChatResult, KeyTestResult } from './providers/types';
import { createTokenPacer, MAX_PACE_WAIT_MS, type TokenPacer } from './transport/pacer';
import { realSleep, withRetry, type Sleep } from './transport/retry';
import { createUsageMeter, type UsageMeter } from './usage/meter';

/** Caps across all chunks of one run. */
export const MAX_CARDS = 30;
export const MAX_QUESTIONS = 20;
export const MAX_KEY_TERMS = 30;
export const MAX_SUMMARY_POINTS = 12;
/** Largest number of block ids a selection may name. */
const MAX_SELECTED = 5_000;

/** Decisions P3b's screens make, read through a port (Q1 = A, F5 consent). */
export interface AiGatePort {
  /** The student confirmed "I'm 18 or older" in the key wizard. */
  isAdultConfirmed(): Promise<boolean>;
  /**
   * The student explicitly said "yes" on the consent screen for this provider
   * and this consent version (PROVIDER_CATALOG[p].consent.version). Apple
   * guideline 5.1.2(i): a stored "yes" for an older version must return false.
   */
  hasConsent(provider: Provider, consentVersion: number, kind: ConsentKind): Promise<boolean>;
}

export interface AiEngineDeps {
  keyVault: KeyVault;
  fetchFn: typeof fetch;
  logger: Logger;
  ids: IdGenerator;
  usageFile: TextFilePort;
  gate: AiGatePort;
  isOnline?: () => Promise<boolean>;
  now?: () => number;
  sleep?: Sleep;
  random?: () => number;
  /** Adapter overrides: the fake provider in tests and in P3b's dev mode. */
  providers?: Partial<Record<Provider, ChatProvider>>;
  /** Per-request timeout override (default 30 s). */
  timeoutMs?: number;
}

export interface RunRequest {
  action: AiActionId;
  provider: Provider;
  doc: NoteDoc;
  scope: AiScope;
  /** The subject's AI switch (Plan F5 "Never send this subject to AI"). */
  aiAllowed: boolean;
}

export type RunProgress =
  | { phase: 'sending'; part: number; parts: number; model: string }
  | { phase: 'waiting'; reason: 'pacing' | 'rate_limited' | 'server' | 'timeout'; waitMs: number }
  | { phase: 'reasking'; part: number }
  | { phase: 'fallback'; model: string };

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (p: RunProgress) => void;
}

export interface AiEngine {
  run(req: RunRequest, opts?: RunOptions): Promise<Proposal>;
  /**
   * Checks a key with a cheap read-only call. With `candidateKey` (P3b key
   * wizard) the NEW key is tested without storing it, so a rejected key never
   * replaces a working one; without it, the stored key is tested.
   */
  testKey(provider: Provider, signal?: AbortSignal, candidateKey?: string): Promise<KeyTestResult>;
  readonly usage: UsageMeter;
  readonly providers: readonly ProviderInfo[];
}

const scopeSchema = z.union([
  z.strictObject({ kind: z.literal('note') }),
  z.strictObject({ kind: z.literal('blocks'), blockIds: z.array(z.string().max(64)).min(1).max(MAX_SELECTED) }),
]);

/** Strips a ```json fence some models add despite JSON mode, then parses. */
export function parseModelJson(content: string): unknown {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(content);
  return JSON.parse(fenced ? (fenced[1] as string) : content);
}

export function createAiEngine(deps: AiEngineDeps): AiEngine {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const random = deps.random ?? Math.random;
  const log = deps.logger.child('ai');
  const usage = createUsageMeter({ file: deps.usageFile, logger: deps.logger, now });
  const adapters = new Map<Provider, ChatProvider>();
  const pacers = new Map<string, TokenPacer>();

  const adapterFor = (id: Provider): ChatProvider => {
    const override = deps.providers?.[id];
    if (override) return override;
    let a = adapters.get(id);
    if (!a) {
      a = createOpenAiCompatibleProvider(id === 'groq' ? GROQ_CONFIG : MISTRAL_CONFIG, {
        getKey: () => deps.keyVault.get(id),
        fetchFn: deps.fetchFn,
        logger: deps.logger,
        now,
        timeoutMs: deps.timeoutMs,
      });
      adapters.set(id, a);
    }
    return a;
  };

  /** One pacer per provider+model (Groq counts limits per model). */
  const pacerFor = (id: Provider, model: string): TokenPacer | null => {
    const tpm = modelTpm(id, model);
    if (tpm === null) return null;
    const k = `${id}:${model}`;
    let p = pacers.get(k);
    if (!p) {
      p = createTokenPacer(tpm, now, sleep);
      pacers.set(k, p);
    }
    return p;
  };

  async function run(req: RunRequest, opts: RunOptions = {}): Promise<Proposal> {
    const { signal, onProgress } = opts;
    const t0 = now();
    const cancelledCheck = () => {
      if (signal?.aborted) throw new AiError('cancelled');
    };

    // --- 1. Inputs and gates -------------------------------------------------
    if (!isActionId(req.action)) throw new AiError('invalid_input', { reason: 'unknown_action' });
    if (!isProvider(req.provider)) throw new AiError('invalid_input', { reason: 'unknown_provider' });
    const action = ACTION_DEFS[req.action];
    const info = PROVIDER_CATALOG[req.provider];
    const label = { providerLabel: info.label };

    if (req.aiAllowed !== true) throw new AiError('blocked', label);
    if (!(await deps.gate.isAdultConfirmed())) throw new AiError('age_required', label);
    // Every engine run sends note TEXT, so only a text consent counts (P3b: kinds are separate).
    if (!(await deps.gate.hasConsent(req.provider, info.consent.version, 'text'))) throw new AiError('consent_required', label);
    if (!(await deps.keyVault.has(req.provider))) throw new AiError('missing_key', label);
    if (deps.isOnline && !(await deps.isOnline())) throw new AiError('offline', label);

    // --- 2. Document and scope ----------------------------------------------
    const v = validateNoteDoc(req.doc);
    if (!v.ok) throw new AiError('invalid_input', { reason: 'doc_invalid' });
    const doc = v.value;
    if (!hasCompleteIds(doc, deps.ids)) throw new AiError('invalid_input', { reason: 'doc_ids_missing' });
    const scopeParsed = scopeSchema.safeParse(req.scope);
    if (!scopeParsed.success) throw new AiError('invalid_input', { reason: 'scope_invalid' });
    const scope = scopeParsed.data as AiScope;
    if (action.needsSelection && scope.kind !== 'blocks') throw new AiError('invalid_input', { reason: 'selection_required' });

    const units = extractUnits(doc, scope);
    if (!units.some((u) => !u.readOnly)) throw new AiError('empty_scope', label);
    const chunked = chunkUnits(units);
    if (!chunked.ok) throw new AiError('too_large', { ...label, reason: chunked.reason });
    const chunks = chunked.chunks;
    if (action.singleChunk && chunks.length > 1) throw new AiError('too_large', { ...label, reason: 'selection_too_long' });
    cancelledCheck();

    // --- 3. Ask, chunk by chunk ---------------------------------------------
    const chat = adapterFor(req.provider);
    const models = providerModels(req.provider);
    let modelIdx = 0; // sticky: once we fall back, later chunks use the fallback too
    const usedModels = new Set<string>();
    const totals = { requests: 0, inputTokens: 0, outputTokens: 0, estimated: false };
    const jsonSchema = toProviderSchema(action.schema);
    const system = buildSystemPrompt(action);

    const record = (model: string, ok: boolean, failure: AiErrorKind | undefined, inTok: number, outTok: number, estimated: boolean, remaining: number | null) =>
      usage.record({ provider: req.provider, model, ok, failure, inputTokens: inTok, outputTokens: outTok, estimated, remainingRequests: remaining });

    /** Sends one request with pacing, retries and model fallback. */
    const callModel = async (user: string, maxOut: number): Promise<{ result: ChatResult; model: string; estIn: number }> => {
      const estIn = estimateTokens(system) + estimateTokens(user);
      for (;;) {
        const model = models[modelIdx] as string;
        const pacer = pacerFor(req.provider, model);
        const reserve = estIn + maxOut;
        if (pacer) {
          const wait = pacer.waitNeeded(reserve);
          if (wait > 0 && wait <= MAX_PACE_WAIT_MS) onProgress?.({ phase: 'waiting', reason: 'pacing', waitMs: wait });
          await pacer.acquire(reserve, signal);
        }
        try {
          const result = await withRetry(
            () =>
              chat.complete(
                { model, system, user, schemaName: action.schemaName, jsonSchema, maxOutputTokens: maxOut, temperature: action.temperature },
                signal,
              ),
            {
              sleep,
              random,
              signal,
              onRetry: (r) => {
                onProgress?.({ phase: 'waiting', reason: r.reason, waitMs: r.waitMs });
                const kind: AiErrorKind = r.reason === 'server' ? 'provider_error' : r.reason === 'timeout' ? 'timeout' : 'rate_limited';
                void record(model, false, kind, 0, 0, false, null);
              },
            },
          );
          pacer?.settle(reserve, result.usage ? result.usage.inputTokens + result.usage.outputTokens : reserve);
          usedModels.add(model);
          return { result, model, estIn };
        } catch (e) {
          if (!isAiError(e)) throw e;
          if (e.kind !== 'cancelled') await record(model, false, e.kind, 0, 0, false, null);
          log.warn('request_failed', { kind: e.kind, status: e.status, model });
          if (e.kind === 'rate_limited' && modelIdx < models.length - 1) {
            modelIdx++;
            onProgress?.({ phase: 'fallback', model: models[modelIdx] as string });
            continue;
          }
          throw e;
        }
      }
    };

    /** Asks for one chunk; parses, validates and interprets; re-asks once (Q6). */
    const askChunk = async <T>(chunk: Unit[], part: number, interpret: (parsed: unknown) => T): Promise<T> => {
      const maxOut = action.maxOutputTokens(chunkTokens(chunk));
      for (const reask of [false, true]) {
        cancelledCheck();
        if (reask) onProgress?.({ phase: 'reasking', part });
        onProgress?.({ phase: 'sending', part, parts: chunks.length, model: models[modelIdx] as string });
        const user = buildUserPrompt(action, chunk, { index: part, total: chunks.length }, reask);
        const { result, model, estIn } = await callModel(user, maxOut);
        const inTok = result.usage?.inputTokens ?? estIn;
        const outTok = result.usage?.outputTokens ?? estimateTokens(result.content);
        const estimated = result.usage === null;
        totals.requests++;
        totals.inputTokens += inTok;
        totals.outputTokens += outTok;
        totals.estimated ||= estimated;

        let reason: string;
        try {
          const json = parseModelJson(result.content);
          const parsed = action.schema.safeParse(json);
          if (!parsed.success) throw new OutputRejected(result.finishReason === 'length' ? 'truncated' : 'schema');
          const value = interpret(parsed.data);
          await record(model, true, undefined, inTok, outTok, estimated, result.rate.remainingRequests);
          return value;
        } catch (e) {
          if (e instanceof OutputRejected) reason = e.reason;
          else if (e instanceof SyntaxError) reason = result.finishReason === 'length' ? 'truncated' : 'not_json';
          else throw e;
        }
        await record(model, false, 'invalid_output', inTok, outTok, estimated, result.rate.remainingRequests);
        log.warn('output_invalid', { reason, part, reask });
        if (reask) throw new AiError('invalid_output', { providerLabel: info.label, reason });
      }
      throw new AiError('internal', { reason: 'unreachable' });
    };

    log.info('run_start', { action: action.id, provider: req.provider, parts: chunks.length, units: units.length });

    const changes: NewChange[] = [];
    const warnings = new Set<string>();
    let cards: CardDraft[] = [];
    let quiz: QuizDraft[] = [];
    const lastTopId = (units[units.length - 1] as Unit).topId;

    try {
      if (action.kind === 'edit') {
        for (const [i, chunk] of chunks.entries()) {
          const built = await askChunk(chunk, i, (p) => buildEditChanges(action, chunk, p as EditPlan));
          changes.push(...built.changes);
          built.warnings.forEach((w) => warnings.add(w));
        }
      } else if (action.kind === 'summary') {
        const points: string[] = [];
        let title: string | null = null;
        for (const [i, chunk] of chunks.entries()) {
          const out = await askChunk(chunk, i, (p) => p as SummaryOut);
          title ??= out.title;
          points.push(...out.points);
        }
        const c = buildSummaryChange({ title, points: points.slice(0, MAX_SUMMARY_POINTS) }, lastTopId);
        if (c) changes.push(c);
      } else if (action.kind === 'keyTerms') {
        let seen = new Set<string>();
        for (const [i, chunk] of chunks.entries()) {
          const { built, nextSeen } = await askChunk(chunk, i, (p) => {
            const copy = new Set(seen); // committed only if the whole answer is valid
            return { built: buildKeyTermChanges(p as KeyTermsOut, chunk, lastTopId, copy), nextSeen: copy };
          });
          seen = nextSeen;
          changes.push(...built);
        }
        changes.splice(MAX_KEY_TERMS);
      } else if (action.kind === 'explain') {
        const chunk = chunks[0] as Unit[];
        const out = await askChunk(chunk, 0, (p) => p as ExplainOut);
        const c = buildExplainChange(out, lastTopId);
        if (c) changes.push(c);
      } else if (action.kind === 'cards') {
        let seen = new Set<string>();
        for (const [i, chunk] of chunks.entries()) {
          const { built, nextSeen } = await askChunk(chunk, i, (p) => {
            const copy = new Set(seen);
            return { built: buildCards(p as CardsOut, chunk, copy), nextSeen: copy };
          });
          seen = nextSeen;
          cards.push(...built);
        }
        cards = cards.slice(0, MAX_CARDS);
      } else {
        let seen = new Set<string>();
        for (const [i, chunk] of chunks.entries()) {
          const { built, nextSeen } = await askChunk(chunk, i, (p) => {
            const copy = new Set(seen);
            return { built: buildQuiz(p as QuizOut, chunk, copy), nextSeen: copy };
          });
          seen = nextSeen;
          quiz.push(...built);
        }
        quiz = quiz.slice(0, MAX_QUESTIONS);
      }
    } catch (e) {
      if (isAiError(e)) throw e;
      log.error('run_bug', { action: action.id });
      throw new AiError('internal', { reason: 'unexpected' });
    }

    if (changes.length === 0 && cards.length === 0 && quiz.length === 0) warnings.add('nothing_found');

    const proposal: Proposal = {
      id: deps.ids.newId('aip'),
      action: action.id,
      provider: req.provider,
      models: [...usedModels],
      promptVersion: action.promptVersion,
      createdAt: now(),
      baseDocJson: canonicalJson(doc),
      sentBlockIds: units.map((u) => u.blockId),
      changes: changes.map((c, i) => ({ ...c, changeId: `c${i + 1}` })),
      cards,
      quiz,
      warnings: [...warnings],
      snapshotReason: action.snapshotReason,
      usage: totals,
    };
    log.info('run_done', { action: action.id, changes: proposal.changes.length, cards: cards.length, questions: quiz.length, ms: now() - t0 });
    return proposal;
  }

  return {
    run,
    testKey: async (provider, signal, candidateKey) => {
      if (!isProvider(provider)) throw new AiError('invalid_input', { reason: 'unknown_provider' });
      if (candidateKey === undefined) return adapterFor(provider).testKey(signal);
      // P3b: test a key the student just pasted, without storing it.
      const n = normalizeKey(provider, candidateKey);
      if (!n.ok) return { ok: false, reason: 'invalid_key' };
      const override = deps.providers?.[provider];
      if (override) return override.testKey(signal); // fake adapter (tests, dev demo)
      const candidate = n.value; // lives only in this closure for the one request
      return createOpenAiCompatibleProvider(provider === 'groq' ? GROQ_CONFIG : MISTRAL_CONFIG, {
        getKey: async () => candidate,
        fetchFn: deps.fetchFn,
        logger: deps.logger,
        now,
        timeoutMs: deps.timeoutMs,
      }).testKey(signal);
    },
    usage,
    providers: Object.values(PROVIDER_CATALOG),
  };
}

/** Exposed for P3b's action sheet. */
export function actionDef(id: AiActionId): ActionDef {
  return ACTION_DEFS[id];
}
