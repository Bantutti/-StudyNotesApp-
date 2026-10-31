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
import { createGroqTranscriber, fileSizeOf, type TranscriptionProvider } from '@/modules/voice';

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
  });
}
