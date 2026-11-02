/**
 * ai: the AI engine (P3a). Public interface only; everything else is internal.
 *
 * - Keys (P0): provider list, key format, masking, the key vault over
 *   expo-secure-store. Unchanged slots, so P0's Groq key keeps working.
 * - Engine (P3a): createAiEngine(deps).run(request) -> Proposal (no changes yet),
 *   testKey(provider), usage meter, provider catalog (18+ rule, data use,
 *   free limits with their check date).
 * - Proposals (P3a): applyProposal / findStaleChanges / undoApply, pure.
 * Docs: docs/modules/ai.md. Maths and algorithms: src/modules/ai/ALGORITHMS.md.
 */
export { PROVIDERS, PROVIDER_INFO, normalizeKey, maskKey, isProvider, type Provider } from './keyFormat';
export { createKeyVault, type KeyVault, type SecretStorePort } from './keyVault';
export { expoSecretStore } from './secureStore';

export {
  createAiEngine,
  actionDef,
  parseModelJson,
  MAX_CARDS,
  MAX_QUESTIONS,
  type AiEngine,
  type AiEngineDeps,
  type AiGatePort,
  type RunRequest,
  type RunOptions,
  type RunProgress,
  type ImageTaskRequest,
} from './engine';
export { AI_ACTIONS, ACTION_DEFS, isActionId, type AiActionId, type ActionDef, type ActionKind } from './actions/registry';
export {
  PROVIDER_CATALOG,
  CONSENT_KINDS,
  consentBlock,
  providersFor,
  providerInfo,
  providerModels,
  type ProviderInfo,
  type ModelLimits,
  type ConsentBlock,
  type ConsentKind,
} from './providers/catalog';
export type { ChatProvider, ChatRequest, ChatResult, KeyTestResult } from './providers/types';
export { createFakeProvider, type FakeProvider, type FakeStep } from './providers/fake';
export { AiError, isAiError, aiMessage, describeWait, AI_ERROR_KINDS, type AiErrorKind, type RateLimitScope } from './errors';
export type { AiScope, AiBlockKind } from './document/units';
export { applyProposal, findStaleChanges, undoApply } from './proposal/apply';
export type { Proposal, BlockChange, ChangeKind, CardDraft, QuizDraft, ApplyResult, UndoRecord, ProposalUsage } from './proposal/types';
export type { UsageMeter, UsageToday, UsageCounter } from './usage/meter';
