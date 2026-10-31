/**
 * Shared test fixtures for the ai module. Not a test file itself
 * (jest only runs *.test.ts).
 *
 * Documents use attrs.blockId, the attribute name P0 core uses today.
 */
import {
  createIdGenerator,
  createLogger,
  memorySink,
  type DocNode,
  type IdGenerator,
  type NoteDoc,
  type TextFilePort,
} from '@/core';

import { createKeyVault, type SecretStorePort } from '../keyVault';

/** Valid core block id: "b_" + 12 letters/digits. */
export const bid = (n: number | string) => `b_t${String(n).padStart(11, '0')}`;

export const text = (t: string, marks?: unknown[]): DocNode => (marks ? ({ type: 'text', text: t, marks } as DocNode) : { type: 'text', text: t });
export const p = (id: string, t?: string | DocNode[]): DocNode =>
  ({ type: 'paragraph', attrs: { blockId: id }, ...(t === undefined ? {} : { content: typeof t === 'string' ? [text(t)] : t }) }) as DocNode;
export const h = (id: string, level: 1 | 2 | 3, t: string): DocNode => ({ type: 'heading', attrs: { level, blockId: id }, content: [text(t)] });
export const li = (id: string, para: DocNode, nested: DocNode[] = []): DocNode => ({ type: 'listItem', attrs: { blockId: id }, content: [para, ...nested] });
export const ul = (id: string, items: DocNode[]): DocNode => ({ type: 'bulletList', attrs: { blockId: id }, content: items });
export const callout = (id: string, paras: DocNode[]): DocNode => ({ type: 'callout', attrs: { blockId: id }, content: paras });
export const def = (id: string, term: string, paras: DocNode[]): DocNode => ({ type: 'definition', attrs: { term, blockId: id }, content: paras });
export const hr = (id: string): DocNode => ({ type: 'horizontalRule', attrs: { blockId: id } });
export const doc = (...content: DocNode[]): NoteDoc => ({ type: 'doc', content });

/** A small lecture note with every block shape the module handles. */
export function sampleDoc(): NoteDoc {
  return doc(
    h(bid(1), 1, 'Cell biology'),
    p(bid(2), 'the mitochondria makes energy for the cell. um it is called the powerhouse'),
    ul(bid(3), [
      li(bid(4), p(bid(5), 'nucleus holds DNA'), [ul(bid(6), [li(bid(7), p(bid(8), 'chromosomes inside'))])]),
      li(bid(9), p(bid(10), 'ribosome makes protein')),
    ]),
    def(bid(11), 'Osmosis', [p(bid(12), 'movement of water across a membrane')]),
    callout(bid(13), [p(bid(14), 'Exam on Friday')]),
    hr(bid(15)),
    p(bid(16)), // empty line
    p(bid(17), [text('See '), text('Khan Academy', [{ type: 'link', attrs: { href: 'https://www.khanacademy.org/' } }]), text(' for more')]),
  );
}

/** Deterministic CSPRNG stand-in (xorshift) so ids are reproducible. */
export function seededIds(seed = 42): IdGenerator {
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

export function memStore(): SecretStorePort & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}

export function memFile(initial: string | null = null): TextFilePort & { content: string | null } {
  const f = {
    content: initial,
    read: async () => f.content,
    write: async (c: string) => {
      f.content = c;
    },
  };
  return f;
}

export const GROQ_KEY = 'gsk_' + 'Zq9'.repeat(18);
export const MISTRAL_KEY = 'Mk7' + 'pQ2'.repeat(10);

export async function vaultWithKeys() {
  const store = memStore();
  const vault = createKeyVault(store);
  await vault.set('groq', GROQ_KEY);
  await vault.set('mistral', MISTRAL_KEY);
  return { store, vault };
}

export function testLogger() {
  const sink = memorySink(5_000);
  return { sink, logger: createLogger({ sink, minLevel: 'debug' }) };
}

/** A fetch Response stand-in with headers and a text body. */
export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const textBody = typeof body === 'string' ? body : JSON.stringify(body);
  let bodyRead = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    text: async () => {
      bodyRead = true;
      return textBody;
    },
    json: async () => {
      bodyRead = true;
      return JSON.parse(textBody);
    },
    get bodyUsed() {
      return bodyRead;
    },
  } as unknown as Response;
}

/** OpenAI-style chat completion body with `content`. */
export function completion(content: unknown, usage = { prompt_tokens: 120, completion_tokens: 80 }, model = 'openai/gpt-oss-120b') {
  return {
    id: 'cmpl-test',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }],
    usage,
  };
}
