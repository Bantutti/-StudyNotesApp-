/**
 * aiui: the AI screens (P3b). Public interface only; everything else is internal.
 *
 * - createAiUi(deps): engine + gate (age result, consents) + local reports
 *   + the flow controller, from plain ports. Composition calls it once.
 * - createAiEditorAction: the "ai" action for P1's sparkle slot.
 * - AiFlowHost: the AI modal (mount once, under AppDataProvider).
 * - AiSettingsScreen: Me -> AI.
 * - Age rule helpers (§1), exported so P4 (Groq Whisper, also 18+) can use
 *   the same gate.
 * Docs: docs/modules/aiui.md. Rules and maths: src/modules/aiui/ALGORITHMS.md.
 */
export { createAiUi, type AiUi, type AiUiDeps, type AiFileName } from './create';
export { createAiEditorAction, AI_ACTION_ID, docHasText } from './flow/action';
export { createAiFlow, visibleActions, AI_CARDS_ENABLED, ACTION_ORDER, type AiFlow, type AiFlowDeps } from './flow/controller';
export { testAndSaveKey } from './flow/keys';
export { errorView } from './flow/messages';
export { createDemoProviders, demoAnswer } from './flow/demo';
export type { FlowSnapshot, FlowStep, ErrorView, NextStep, SaveKeyResult, ScopeChoice, UsageLine, ProviderStatus } from './flow/types';
export { createGateStore, GATE_FILE_VERSION, type GateStore, type AgeStatus } from './gate/gateStore';
export { checkCanSend, assertCanSend, type SendRequest, type SendCheck } from './gate/sendCheck';
export { createReportsStore, REPORT_REASONS, REPORT_COMMENT_MAX, MAX_REPORTS, type ReportsStore, type AiReport, type ReportReason } from './gate/reportsStore';
export { checkYear, checkMonth, checkDay, localDate, recheckDueAt, ADULT_AGE, type AgeStep, type LocalDate } from './gate/ageRule';
export { buildDiffRows, initialAccepted, type DiffRow } from './diff/viewModel';
export { wordDiff, MAX_DIFF_WORDS, type DiffSegment } from './diff/wordDiff';
export { usageText, progressText, waitText } from './format';
export type { AiScreenPorts, ClipboardPort } from './ports';
export { AiFlowHost } from './components/AiFlowHost';
/** Reusable consent screen; P5 renders it with kind="image" before its vision pass. */
export { ConsentStep } from './components/ConsentStep';
export { AiSettingsScreen, type SubjectsPort } from './components/AiSettingsScreen';
