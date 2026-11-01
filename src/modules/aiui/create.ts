/**
 * Builds everything the AI screens need from plain ports, so composition
 * adds only a few lines (P3a MERGE_NOTES §6 snippet, extended).
 *
 *   engine   real engine (Groq, Mistral) with the gate below as AiGatePort
 *   demo     Demo AI engine (fake adapters), development builds only
 *   gate     ai/gate.json: age result, consents, default provider
 *   reports  ai/reports.json: local "Report this AI result" records
 *   flow     the state machine the modal renders
 */
import type { IdGenerator, Logger, TextFilePort } from '@/core';
import { createAiEngine, PROVIDERS, type AiEngine, type KeyVault, type Provider } from '@/modules/ai';

import { createAiFlow, type AiFlow } from './flow/controller';
import { createDemoProviders } from './flow/demo';
import { testAndSaveKey } from './flow/keys';
import type { SaveKeyResult } from './flow/types';
import { createGateStore, type GateStore } from './gate/gateStore';
import { createReportsStore, type ReportsStore } from './gate/reportsStore';

/** The fixed file names in the app's ai/ folder (never user input). */
export type AiFileName = 'usage.json' | 'gate.json' | 'reports.json';

export interface AiUiDeps {
  keyVault: KeyVault;
  fetchFn: typeof fetch;
  logger: Logger;
  ids: IdGenerator;
  /** TextFilePort for documents/ai/<name>. */
  aiFile: (name: AiFileName) => TextFilePort;
  /** Development build (__DEV__). Demo AI is impossible when false. */
  isDev: boolean;
  now?: () => number;
  /** Tests: adapter overrides for the real engine (P3a's fake provider). */
  providers?: Parameters<typeof createAiEngine>[0]['providers'];
}

export interface AiUi {
  engine: AiEngine;
  gate: GateStore;
  reports: ReportsStore;
  flow: AiFlow;
  /** The engine for the next run: Demo AI only in dev builds with the switch on. */
  activeEngine(): Promise<AiEngine>;
  isDemo(): Promise<boolean>;
  /** Test-then-save a key outside the flow (AI settings: Add / Replace). */
  saveKey(p: Provider, raw: string, force?: boolean): Promise<SaveKeyResult>;
  /** Delete all data: remove every provider key from secure storage. */
  wipeSecrets(): Promise<void>;
  /** Delete all data: drop in-memory copies after the ai folder was deleted. */
  forget(): void;
}

/** A TextFilePort that lives only in memory (Demo AI usage). */
function memoryTextFile(): TextFilePort {
  let content: string | null = null;
  return {
    read: async () => content,
    write: async (c) => {
      content = c;
    },
  };
}

export function createAiUi(deps: AiUiDeps): AiUi {
  const usageFile = deps.aiFile('usage.json');
  const gate = createGateStore({ file: deps.aiFile('gate.json'), logger: deps.logger, now: deps.now });
  const reports = createReportsStore({ file: deps.aiFile('reports.json'), ids: deps.ids, logger: deps.logger, now: deps.now });
  const base = { keyVault: deps.keyVault, fetchFn: deps.fetchFn, logger: deps.logger, ids: deps.ids, usageFile, gate, now: deps.now };
  const engine = createAiEngine({ ...base, providers: deps.providers });
  // Demo AI shares the gate and key vault, so the flow is the real one; only the answers are fake.
  // Its usage is counted in memory, so demo runs never inflate the real "N of 1,000 today".
  const demo = deps.isDev ? createAiEngine({ ...base, usageFile: memoryTextFile(), providers: createDemoProviders() }) : null;

  const isDemo = async () => demo !== null && (await gate.fakeMode());
  const activeEngine = async () => ((await isDemo()) && demo ? demo : engine);

  const flow = createAiFlow({ engine: activeEngine, isDemo, gate, keyVault: deps.keyVault, reports, ids: deps.ids, logger: deps.logger });

  return {
    engine,
    gate,
    reports,
    flow,
    activeEngine,
    isDemo,
    saveKey: async (p, raw, force = false) =>
      testAndSaveKey({ engine: await activeEngine(), keyVault: deps.keyVault, logger: deps.logger.child('ai_keys') }, p, raw, force),
    async wipeSecrets() {
      // Every provider slot, not just Groq (fixes P1's wipe that left the Mistral key behind).
      for (const p of PROVIDERS) await deps.keyVault.remove(p);
    },
    forget() {
      gate.forget();
      reports.forget();
      engine.usage.reload();
      demo?.usage.reload();
    },
  };
}
