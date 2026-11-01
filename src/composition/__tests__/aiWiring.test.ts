/**
 * P3b in the composition root:
 * - the "ai" action through P1's runEditorAction with a real store: the
 *   "Before AI change" version is saved, and Undo restores the exact
 *   previous document with the same block ids (exit criterion);
 * - Cancel/close saves nothing;
 * - the subject switch fails closed;
 * - Delete all data removes BOTH provider keys and the ai folder's state
 *   (the two bugs found in P1's services.ts).
 */
import { createLogger, createSeqIdGenerator, listBlockIds, memorySink, type NoteDoc } from '@/core';
import { createFakeProvider } from '@/modules/ai';
import { createAiEditorAction, createAiUi } from '@/modules/aiui';
import type { EditorHost } from '@/modules/editor';
import { openStore } from '@/modules/store';
import { DEFAULT_PACK_ID } from '@/modules/stylepacks';

import { nodeSqliteDriver } from '../../../test/nodeSqlite';
import { storedNoteHasText, subjectAiAllowed } from '../aiWiring';
import { runEditorAction } from '../editorActions';
import { APP_FOLDERS, createServicesWith, transcriptionAllowed, type Adapters } from '../services';

const GROQ_KEY = 'gsk_' + 'Ab9'.repeat(18);
const MISTRAL_KEY = 'Mz7' + 'Qx4'.repeat(10);
const line = (text: string, id: string) => ({ type: 'paragraph' as const, attrs: { blockId: id }, content: [{ type: 'text' as const, text }] });
const start: NoteDoc = { type: 'doc', content: [line('the mitochondria makes energy', 'b_aiwire00000001'), line('osmosis moves water', 'b_aiwire00000002')] };

function adapters(over: Partial<Adapters> = {}) {
  const secrets = new Map<string, string>();
  const aiFiles = new Map<string, string>();
  let wiped = 0;
  const a: Adapters = {
    resultsFile: { read: async () => null, write: async () => undefined },
    aiFile: (name) => ({ read: async () => aiFiles.get(name) ?? null, write: async (c) => void aiFiles.set(name, c) }),
    secretStore: { get: async (k) => secrets.get(k) ?? null, set: async (k, v) => void secrets.set(k, v), remove: async (k) => void secrets.delete(k) },
    print: { printToFile: async () => ({ uri: 'file:///x.pdf' }), print: async () => undefined },
    files: { writeBytes: async (n, b) => ({ uri: `file:///${n}`, size: b.length }), sizeOf: () => 10 },
    share: { share: async () => undefined },
    readAsset: async () => 'AAAA',
    fetchFn: (async () => {
      throw new Error('no network in tests');
    }) as unknown as typeof fetch,
    fileSize: () => 1,
    randomBytes: (n) => new Uint8Array(n).fill(7),
    device: { os: 'android', osVersion: '15', model: 'Test', runtime: 'expo-go', isTablet: false },
    isDev: false,
    linkPorts: { openExternal: async () => undefined, confirm: async () => false },
    database: {
      openDriver: async () => nodeSqliteDriver(),
      deleteDatabase: async () => undefined,
      // What the real wipe does to the ai folder: every file in it is gone.
      wipeFiles: async () => {
        wiped++;
        aiFiles.clear();
      },
    },
    ...over,
  };
  return { a, secrets, aiFiles, wipedCount: () => wiped };
}

async function noteWorld(handOver?: NoteDoc) {
  let t = Date.UTC(2026, 10, 1);
  const ids = createSeqIdGenerator();
  const store = await openStore(nodeSqliteDriver(), { ids, logger: createLogger({ sink: memorySink() }), now: () => (t += 1000) });
  const note = await store.notes.create({ stylePackId: DEFAULT_PACK_ID, document: start });
  let current: NoteDoc = handOver ?? note.document;
  const host: EditorHost = {
    getDocument: async () => current,
    getSelection: async () => null,
    showDocument: (d) => {
      current = d;
    },
  };
  return { store, note, host, ids, current: () => current };
}

describe('AI action through runEditorAction (real store)', () => {
  it('Apply saves "Before AI change", and Undo restores the exact note with the same ids', async () => {
    const groq = createFakeProvider('groq', [{ json: { units: [{ ref: 'u1', op: 'replace', blocks: [{ kind: 'paragraph', term: null, text: 'The **mitochondria** makes energy.' }] }] } }]);
    const { a } = adapters();
    const s = createServicesWith(a);
    // Same services, but the engine talks to the fake adapter (tests only).
    const ui = createAiUi({ keyVault: s.keyVault, fetchFn: a.fetchFn, logger: s.logger, ids: s.ids, aiFile: a.aiFile, isDev: false, providers: { groq } });
    await s.keyVault.set('groq', GROQ_KEY);
    await ui.gate.recordAge(true);
    await ui.gate.giveConsent('groq', 1, 'text');

    const w = await noteWorld();
    const action = createAiEditorAction({ flow: ui.flow, subjectAiAllowed: async () => true, storedNoteHasText: (id) => storedNoteHasText(w.store, id) });
    const running = runEditorAction(action, { store: w.store, ids: w.ids, host: w.host }, w.note.id);
    await new Promise((r) => setTimeout(r, 0));
    await ui.flow.chooseAction('beautify');
    for (let i = 0; i < 5 && ui.flow.getSnapshot().step.name !== 'preview'; i++) await new Promise((r) => setImmediate(r));
    expect(ui.flow.getSnapshot().step.name).toBe('preview');
    await ui.flow.apply();
    const outcome = await running;

    expect(outcome?.message).toBe('Beautify: 1 change applied');
    const saved = (await w.store.notes.get(w.note.id))!.document;
    expect(JSON.stringify(saved)).toContain('"bold"');
    expect(listBlockIds(saved)).toEqual(listBlockIds(start));
    const versions = await w.store.versions.list(w.note.id);
    expect(versions.map((v) => v.reason)).toEqual(['before_ai']);
    expect((await w.store.versions.get(versions[0]!.id))!.document).toEqual(start);

    await outcome!.undo();
    const back = (await w.store.notes.get(w.note.id))!.document;
    expect(back).toEqual(start); // exact, same block ids
    expect(w.current()).toEqual(start);
  });

  it('closing the AI panel is a cancel: nothing saved, no version', async () => {
    const { a } = adapters();
    const s = createServicesWith(a);
    const w = await noteWorld();
    const action = createAiEditorAction({ flow: s.aiui.flow, subjectAiAllowed: async () => true, storedNoteHasText: (id) => storedNoteHasText(w.store, id) });
    const running = runEditorAction(action, { store: w.store, ids: w.ids, host: w.host }, w.note.id);
    await new Promise((r) => setTimeout(r, 0));
    s.aiui.flow.close();
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    expect((await w.store.notes.get(w.note.id))!.document).toEqual(start);
    expect(await w.store.versions.list(w.note.id)).toHaveLength(0);
  });

  it('a subject lookup that fails counts as "AI off" (fail closed)', async () => {
    const { a } = adapters();
    const s = createServicesWith(a);
    const action = createAiEditorAction({
      flow: s.aiui.flow,
      subjectAiAllowed: async () => {
        throw new Error('db closed');
      },
      storedNoteHasText: async () => true,
    });
    const w = await noteWorld();
    const running = runEditorAction(action, { store: w.store, ids: w.ids, host: w.host }, w.note.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(s.aiui.flow.getSnapshot().step.name).toBe('blocked');
    s.aiui.flow.close();
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('subjectAiAllowed reads the subject switch', async () => {
    const w = await noteWorld();
    const subj = await w.store.subjects.create({ name: 'Private', color: '4F7CF7' });
    expect(await subjectAiAllowed(w.store, null)).toBe(true);
    expect(await subjectAiAllowed(w.store, subj.id)).toBe(true);
    await w.store.subjects.update(subj.id, { aiAllowed: false });
    expect(await subjectAiAllowed(w.store, subj.id)).toBe(false);
  });
});

describe('Delete all data (P1 bugs fixed in P3b)', () => {
  it('removes BOTH provider keys (Mistral was left behind before)', async () => {
    const { a, secrets } = adapters();
    const s = createServicesWith(a);
    await s.keyVault.set('groq', GROQ_KEY);
    await s.keyVault.set('mistral', MISTRAL_KEY);
    await s.appData.wipeSecrets();
    expect(await s.keyVault.has('groq')).toBe(false);
    expect(await s.keyVault.has('mistral')).toBe(false);
    expect(secrets.size).toBe(0);
  });

  it('wipes the ai folder and forgets cached answers, consents, reports and usage', async () => {
    const { a, aiFiles, wipedCount } = adapters();
    const s = createServicesWith(a);
    await s.aiui.gate.recordAge(true);
    await s.aiui.gate.giveConsent('groq', 1, 'text');
    await s.aiui.reports.add({ action: 'beautify', provider: 'groq', models: ['m'], promptVersion: 'v', reason: 'wrong', comment: '' });
    await s.ai.usage.record({ provider: 'groq', model: 'openai/gpt-oss-120b', ok: true, inputTokens: 10, outputTokens: 5, estimated: false });
    expect([...aiFiles.keys()].sort()).toEqual(['gate.json', 'reports.json', 'usage.json']);

    await s.appData.wipeFiles();
    expect(wipedCount()).toBe(1);
    expect(aiFiles.size).toBe(0);
    expect(await s.aiui.gate.isAdultConfirmed()).toBe(false);
    expect(await s.aiui.gate.hasConsent('groq', 1, 'text')).toBe(false);
    expect(await s.aiui.reports.list()).toEqual([]);
    expect((await s.ai.usage.today('groq')).requests).toBe(0);
    expect(aiFiles.size).toBe(0); // reading didn't recreate any file
  });

  it("the real app wipe covers the 'ai' folder", () => {
    expect(APP_FOLDERS).toContain('ai');
  });
});

describe('P1 empty-document bug guard (Lead, Nov 1)', () => {
  const EMPTY: NoteDoc = { type: 'doc', content: [] };

  it('an empty hand-over while the stored note has text: refused, flow never opens, nothing saved', async () => {
    const { a } = adapters();
    const s = createServicesWith(a);
    const w = await noteWorld(EMPTY); // the editor hands over an empty doc (P1 bug)
    const action = createAiEditorAction({ flow: s.aiui.flow, subjectAiAllowed: async () => true, storedNoteHasText: (id) => storedNoteHasText(w.store, id) });
    await expect(runEditorAction(action, { store: w.store, ids: w.ids, host: w.host }, w.note.id)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('couldn’t be read just now'),
    });
    expect(s.aiui.flow.getSnapshot().step.name).toBe('closed');
    expect((await w.store.notes.get(w.note.id))!.document).toEqual(start);
    expect(await w.store.versions.list(w.note.id)).toHaveLength(0);
  });

  it('a doc with only an empty line counts as empty too', async () => {
    const { a } = adapters();
    const s = createServicesWith(a);
    const w = await noteWorld({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b_aiwire00000009' } }] });
    const action = createAiEditorAction({ flow: s.aiui.flow, subjectAiAllowed: async () => true, storedNoteHasText: (id) => storedNoteHasText(w.store, id) });
    await expect(runEditorAction(action, { store: w.store, ids: w.ids, host: w.host }, w.note.id)).rejects.toMatchObject({ code: 'validation_failed' });
    expect((await w.store.notes.get(w.note.id))!.document).toEqual(start);
  });

  it('fails closed when the stored note cannot be read', async () => {
    const { a } = adapters();
    const s = createServicesWith(a);
    const w = await noteWorld(EMPTY);
    const action = createAiEditorAction({
      flow: s.aiui.flow,
      subjectAiAllowed: async () => true,
      storedNoteHasText: async () => {
        throw new Error('db closed');
      },
    });
    await expect(runEditorAction(action, { store: w.store, ids: w.ids, host: w.host }, w.note.id)).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('a genuinely empty note (stored empty too) still opens the panel', async () => {
    const { a } = adapters();
    const s = createServicesWith(a);
    const w = await noteWorld(EMPTY);
    await w.store.notes.save(w.note.id, { document: EMPTY });
    const action = createAiEditorAction({ flow: s.aiui.flow, subjectAiAllowed: async () => true, storedNoteHasText: (id) => storedNoteHasText(w.store, id) });
    const running = runEditorAction(action, { store: w.store, ids: w.ids, host: w.host }, w.note.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(s.aiui.flow.getSnapshot().step.name).toBe('actions');
    s.aiui.flow.close();
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('Apply refuses a result that would remove all the text', async () => {
    const groq = createFakeProvider('groq', [{ json: { units: [{ ref: 'u1', op: 'delete', blocks: [] }, { ref: 'u2', op: 'delete', blocks: [] }] } }]);
    const { a } = adapters();
    const s = createServicesWith(a);
    const ui = createAiUi({ keyVault: s.keyVault, fetchFn: a.fetchFn, logger: s.logger, ids: s.ids, aiFile: a.aiFile, isDev: false, providers: { groq } });
    await s.keyVault.set('groq', GROQ_KEY);
    await ui.gate.recordAge(true);
    await ui.gate.giveConsent('groq', 1, 'text');
    const w = await noteWorld();
    const action = createAiEditorAction({ flow: ui.flow, subjectAiAllowed: async () => true, storedNoteHasText: (id) => storedNoteHasText(w.store, id) });
    const running = runEditorAction(action, { store: w.store, ids: w.ids, host: w.host }, w.note.id);
    await new Promise((r) => setTimeout(r, 0));
    await ui.flow.chooseAction('beautify');
    for (let i = 0; i < 5 && ui.flow.getSnapshot().step.name !== 'preview'; i++) await new Promise((r) => setImmediate(r));
    expect(ui.flow.getSnapshot().rows).toHaveLength(2);
    await ui.flow.apply();
    const st = ui.flow.getSnapshot().step;
    expect(st.name).toBe('error');
    if (st.name === 'error') expect(st.error.message).toContain('removed all the text');
    ui.flow.close();
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    expect((await w.store.notes.get(w.note.id))!.document).toEqual(start);
    expect(await w.store.versions.list(w.note.id)).toHaveLength(0);
  });
});

describe('the AI gate is the only route to Groq in release builds', () => {
  it('release: the transcriber never gets the key, even after 18+ and TEXT consent (audio is its own kind, P4)', async () => {
    const calls: string[] = [];
    const { a } = adapters({
      fetchFn: (async (url: unknown) => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => ({}) };
      }) as unknown as typeof fetch,
    });
    const s = createServicesWith(a);
    await s.keyVault.set('groq', GROQ_KEY);
    await s.aiui.gate.recordAge(true);
    await s.aiui.gate.giveConsent('groq', 1, 'text');
    await s.aiui.gate.giveConsent('groq', 1, 'image');
    await expect(s.transcriber.testKey()).rejects.toMatchObject({ code: 'missing_key' });
    expect(await transcriptionAllowed(false, s.aiui)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('development builds keep the P0 spike screens working', async () => {
    const calls: string[] = [];
    const { a } = adapters({
      isDev: true,
      fetchFn: (async (url: unknown) => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => ({}) };
      }) as unknown as typeof fetch,
    });
    const s = createServicesWith(a);
    await s.keyVault.set('groq', GROQ_KEY);
    expect(await s.transcriber.testKey()).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
