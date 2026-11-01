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
import { createKeyVault, expoSecretStore, type KeyVault, type SecretStorePort } from '@/modules/ai';
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
  /** Editor actions (Beautify Lite now; P3b registers AI actions here). */
  editorActions: EditorActionRegistry;
  /** Adapters for the app data lifecycle (database, wipe). */
  appData: AppDataDeps;
  getFaces(pack: StylePack): Promise<FontFaceData[]>;
}

export interface Adapters {
  resultsFile: TextFilePort;
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
  const faceCache = new Map<string, Promise<FontFaceData[]>>();
  return {
    logger,
    ids,
    results: createResultsStore({ file: a.resultsFile, ids, device: a.device, logger }),
    packs: createPackRegistry(),
    keyVault,
    transcriber: createGroqTranscriber({
      getKey: () => keyVault.get('groq'),
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
    appData: {
      ...a.database,
      wipeSecrets: () => keyVault.remove('groq'),
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

export function createServices(): Services {
  return createServicesWith({
    resultsFile: expoTextFile('p0', 'spike-results.jsonl'),
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

/** App-made folders outside the database. Fixed names only, never user input. */
const APP_FOLDERS = ['p0', 'recordings', 'ink'] as const; // 'ink': P4b drawings (working + published copies)

async function wipeAppFiles(): Promise<void> {
  for (const name of APP_FOLDERS) {
    const dir = new Directory(Paths.document, name);
    if (dir.exists) dir.delete();
  }
}
