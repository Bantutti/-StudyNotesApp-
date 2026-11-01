/**
 * Composition root: the only place where concrete adapters are chosen.
 * Screens receive Services through React context (ServicesProvider).
 * Tests build Services with fakes via createServicesWith().
 */
import {
  consoleSink,
  createIdGenerator,
  createLogger,
  createResultsStore,
  expoTextFile,
  getDeviceInfo,
  secureRandomBytes,
  type IdGenerator,
  type Logger,
  type ResultsStore,
  type TextFilePort,
} from '@/core';
import { createKeyVault, expoSecretStore, type AiEngine, type KeyVault, type SecretStorePort } from '@/modules/ai';
import { createAiUi, type AiFileName, type AiUi } from '@/modules/aiui';
import {
  createDocxExporter,
  createPdfExporter,
  createPrintExporter,
  expoFiles,
  expoPrint,
  expoShare,
  type Exporter,
  type FileWriterPort,
  type PrintPort,
  type SharePort,
} from '@/modules/export';
import {
  createPackRegistry,
  expoAssetReader,
  loadFaces,
  type AssetReader,
  type FontFaceData,
  type PackRegistry,
  type StylePack,
} from '@/modules/stylepacks';
import { createEditorActionRegistry, createLinkOpener, expoLinkPorts, type EditorActionRegistry, type LinkOpener, type LinkPorts } from '@/modules/editor';
import { deleteExpoDatabase, openExpoDriver } from '@/modules/store';
import { createTemplateRegistry, type TemplateRegistry } from '@/modules/templates';
import { createGroqTranscriber, fileSizeOf, type TranscriptionProvider } from '@/modules/voice';
import { Directory, Paths } from 'expo-file-system';

import type { AppDataDeps } from './appData';
import { beautifyLiteAction } from './editorActions';

import { createNoteStore, type NoteStore } from './noteStore';

export interface Services {
  logger: Logger;
  ids: IdGenerator;
  results: ResultsStore;
  packs: PackRegistry;
  keyVault: KeyVault;
  transcriber: TranscriptionProvider;
  exporters: { pdf: Exporter; docx: Exporter; print: Exporter };
  share: SharePort;
  notes: NoteStore;
  /** Opens note links OUTSIDE the app after a confirm (Apple age-rating rule). */
  links: LinkOpener;
  /** Built-in note templates (validated data). */
  templates: TemplateRegistry;
  /** Editor actions (Beautify Lite; P3b's "ai" action is registered by AiWiring). */
  editorActions: EditorActionRegistry;
  /** P3b: the AI engine (P3a) and everything its screens need (gate, reports, flow). */
  ai: AiEngine;
  aiui: AiUi;
  /** Adapters for the app data lifecycle (database, wipe). */
  appData: AppDataDeps;
  getFaces(pack: StylePack): Promise<FontFaceData[]>;
}

export interface Adapters {
  resultsFile: TextFilePort;
  /** P3b: files in documents/ai/ (usage meter, gate answers, local reports). */
  aiFile: (name: AiFileName) => TextFilePort;
  secretStore: SecretStorePort;
  print: PrintPort;
  files: FileWriterPort;
  share: SharePort;
  readAsset: AssetReader;
  fetchFn: typeof fetch;
  fileSize: (uri: string) => number | null;
  randomBytes: (n: number) => Uint8Array;
  device: ReturnType<typeof getDeviceInfo>;
  isDev: boolean;
  linkPorts: LinkPorts;
  database: Pick<AppDataDeps, 'openDriver' | 'deleteDatabase' | 'wipeFiles'>;
}

export function createServicesWith(a: Adapters): Services {
  const logger = createLogger({ sink: consoleSink(a.isDev), minLevel: a.isDev ? 'debug' : 'warn' });
  const ids = createIdGenerator(a.randomBytes);
  const keyVault = createKeyVault(a.secretStore);
  const aiui = createAiUi({ keyVault, fetchFn: a.fetchFn, logger, ids, aiFile: a.aiFile, isDev: a.isDev });
  const faceCache = new Map<string, Promise<FontFaceData[]>>();
  return {
    logger,
    ids,
    results: createResultsStore({ file: a.resultsFile, ids, device: a.device, logger }),
    packs: createPackRegistry(),
    keyVault,
    transcriber: createGroqTranscriber({
      // P3b: in release builds Groq gets the key only after the 18+ check and Groq consent
      // (the AI gate is the only route to any Groq call). Dev builds keep the P0 spikes working.
      getKey: async () => ((await transcriptionAllowed(a.isDev, aiui)) ? keyVault.get('groq') : null),
      fetchFn: a.fetchFn,
      fileSize: a.fileSize,
      logger,
    }),
    exporters: {
      pdf: createPdfExporter(a.print, a.files),
      docx: createDocxExporter(a.files),
      print: createPrintExporter(a.print),
    },
    share: a.share,
    notes: createNoteStore(),
    links: createLinkOpener(a.linkPorts),
    templates: createTemplateRegistry(),
    editorActions: createEditorActionRegistry([beautifyLiteAction]),
    ai: aiui.engine,
    aiui,
    appData: {
      ...a.database,
      // P3b fix: also drop the AI module's in-memory copies once the ai folder is gone.
      wipeFiles: async () => {
        await a.database.wipeFiles();
        aiui.forget();
      },
      // P3b fix: every AI provider key (was Groq only, so a Mistral key survived Delete all data).
      wipeSecrets: () => aiui.wipeSecrets(),
      ids,
      logger,
    },
    getFaces(pack) {
      const key = `${pack.fonts.header}|${pack.fonts.body}`;
      let p = faceCache.get(key);
      if (!p) {
        p = loadFaces(pack, a.readAsset).catch((e: unknown) => {
          faceCache.delete(key);
          throw e;
        });
        faceCache.set(key, p);
      }
      return p;
    },
  };
}

/**
 * Release builds: no Groq transcription yet. Audio is its own data kind, and
 * a text consent must never authorise it (Lead, Nov 1: kinds are separate),
 * so release stays closed until P4 adds an 'audio' consent kind to the
 * catalog and replaces this with checkCanSend(gate, { provider: 'groq',
 * kind: 'audio' }). Development builds keep the P0 spike screens working.
 */
export async function transcriptionAllowed(isDev: boolean, _aiui: AiUi): Promise<boolean> {
  return isDev;
}

export function createServices(): Services {
  return createServicesWith({
    resultsFile: expoTextFile('p0', 'spike-results.jsonl'),
    aiFile: (name) => expoTextFile('ai', name),
    secretStore: expoSecretStore,
    print: expoPrint,
    files: expoFiles,
    share: expoShare,
    readAsset: expoAssetReader,
    fetchFn: (input, init) => fetch(input, init),
    fileSize: fileSizeOf,
    randomBytes: secureRandomBytes,
    device: getDeviceInfo(),
    isDev: __DEV__,
    linkPorts: expoLinkPorts,
    database: { openDriver: () => openExpoDriver(), deleteDatabase: () => deleteExpoDatabase(), wipeFiles: wipeAppFiles },
  });
}

/**
 * App-made folders outside the database. Fixed names only, never user input.
 * P3b fix: 'ai' (usage meter, gate answers, reports) was missing, so
 * Delete all data left ai/usage.json behind.
 */
export const APP_FOLDERS = ['p0', 'recordings', 'ai'] as const;

async function wipeAppFiles(): Promise<void> {
  for (const name of APP_FOLDERS) {
    const dir = new Directory(Paths.document, name);
    if (dir.exists) dir.delete();
  }
}
