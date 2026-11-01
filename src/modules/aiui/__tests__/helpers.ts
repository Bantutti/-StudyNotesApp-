/**
 * Shared test helpers for aiui: in-memory files and secret store, a logger
 * that records everything (for the "never logs secrets" checks).
 */
import { createIdGenerator, createLogger, memorySink, type DocNode, type IdGenerator, type LogRecord, type NoteDoc, type TextFilePort } from '@/core';
import { createFakeProvider, createKeyVault, type FakeProvider, type FakeStep, type KeyVault, type SecretStorePort } from '@/modules/ai';
import type { EditorActionContext } from '@/modules/editor';
import { createAiUi, type AiFileName, type AiUi } from '../create';

export function memoryFile(initial: string | null = null): TextFilePort & { content: string | null; writes: number } {
  const f = {
    content: initial,
    writes: 0,
    read: async () => f.content,
    write: async (c: string) => {
      f.content = c;
      f.writes++;
    },
  };
  return f;
}

export function memorySecrets(): SecretStorePort & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    remove: async (k) => void map.delete(k),
  };
}

/** A debug-level logger plus every record it wrote, serialised for searching. */
export function spyLogger() {
  const sink = memorySink(10_000);
  const logger = createLogger({ sink, minLevel: 'debug' });
  return {
    logger,
    records: sink.records as LogRecord[],
    /** Everything the logger saw, as one string (events, scopes and fields). */
    dump: () => JSON.stringify(sink.records),
  };
}

// ---------------------------------------------------------------------------
// Flow fixtures (fake providers, memory files, a note with stable block ids).



/** Valid core block id: "b_" + 14 characters. */
export const bid = (n: number) => `b_ui${String(n).padStart(12, '0')}`;
export const para = (id: string, text: string): DocNode => ({ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text }] });
export const heading = (id: string, text: string): DocNode => ({ type: 'heading', attrs: { level: 2, blockId: id }, content: [{ type: 'text', text }] });

/** A small note: a heading and two lines. */
export function noteDoc(): NoteDoc {
  return {
    type: 'doc',
    content: [heading(bid(1), 'Cells'), para(bid(2), 'the mitochondria makes energy'), para(bid(3), 'osmosis moves water')],
  };
}

/** Deterministic id generator (xorshift) so tests are reproducible. */
export function seededIds(seed = 7): IdGenerator {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s & 0xff;
  };
  return createIdGenerator((n) => Uint8Array.from({ length: n }, next));
}

export const GROQ_KEY = 'gsk_' + 'Ab9'.repeat(18);
export const MISTRAL_KEY = 'Mz7' + 'Qx4'.repeat(10);

/** Edit-plan answer replacing one ref with new text (paragraph). */
export const replaceAnswer = (ref: string, text: string, kind = 'paragraph'): FakeStep => ({ json: { units: [{ ref, op: 'replace', blocks: [{ kind, term: null, text }] }] } });

export interface FlowWorld {
  ui: AiUi;
  vault: KeyVault;
  secrets: ReturnType<typeof memorySecrets>;
  files: Map<AiFileName, ReturnType<typeof memoryFile>>;
  groq: FakeProvider;
  mistral: FakeProvider;
  fetchFn: jest.Mock;
  log: ReturnType<typeof spyLogger>;
  ids: IdGenerator;
  ctx(over?: Partial<EditorActionContext>): EditorActionContext;
}

/**
 * A full AI UI with fake adapters. `fetchFn` throws: any real network use
 * fails the test. Options pre-answer the gates.
 */
export async function flowWorld(opts: { steps?: FakeStep[]; adult?: boolean | null; consent?: boolean; groqKey?: boolean; mistralKey?: boolean; isDev?: boolean } = {}): Promise<FlowWorld> {
  const secrets = memorySecrets();
  const vault = createKeyVault(secrets);
  const files = new Map<AiFileName, ReturnType<typeof memoryFile>>();
  const aiFile = (name: AiFileName) => {
    let f = files.get(name);
    if (!f) {
      f = memoryFile();
      files.set(name, f);
    }
    return f;
  };
  const groq = createFakeProvider('groq', opts.steps ?? [replaceAnswer('u2', 'The **mitochondria** makes energy.')]);
  const mistral = createFakeProvider('mistral', opts.steps ?? [replaceAnswer('u2', 'Mistral version.')]);
  const fetchFn = jest.fn(async () => {
    throw new Error('real network must not be used in this test');
  });
  const log = spyLogger();
  const ids = seededIds();
  const ui = createAiUi({ keyVault: vault, fetchFn: fetchFn as unknown as typeof fetch, logger: log.logger, ids, aiFile, isDev: opts.isDev ?? false, providers: { groq, mistral } });
  if (opts.groqKey) await vault.set('groq', GROQ_KEY);
  if (opts.mistralKey) await vault.set('mistral', MISTRAL_KEY);
  if (opts.adult !== undefined && opts.adult !== null) await ui.gate.recordAge(opts.adult);
  if (opts.consent) {
    await ui.gate.giveConsent('groq', 1);
    await ui.gate.giveConsent('mistral', 1);
  }
  const ctx = (over: Partial<EditorActionContext> = {}): EditorActionContext => ({
    noteId: 'n_test0000000000001',
    subjectId: null,
    title: 'Cells',
    stylePackId: 'pastel-highlight',
    doc: noteDoc(),
    selection: null,
    ids,
    ...over,
  });
  return { ui, vault, secrets, files, groq, mistral, fetchFn, log, ids, ctx };
}

/** Lets pending promise callbacks run (the controller is async between steps). */
export const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
};
