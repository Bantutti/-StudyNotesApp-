/**
 * Demo AI (development builds only): never available in release builds,
 * every answer passes the action's schema, and its usage never touches the
 * real usage file.
 */
import { ACTION_DEFS, AI_ACTIONS, parseModelJson } from '@/modules/ai';

import { demoAnswer } from '../flow/demo';
import { flowWorld, flush } from './helpers';

const user = [
  'Action: Beautify.',
  '<note_blocks>',
  JSON.stringify({ ref: 'u1', kind: 'heading2', term: null, text: 'Cells', readOnly: false, depth: 0 }),
  JSON.stringify({ ref: 'u2', kind: 'paragraph', term: null, text: 'the **mitochondria** makes energy \\u003cb\\u003e', readOnly: false, depth: 0 }),
  '</note_blocks>',
].join('\n');

describe('Demo AI', () => {
  it.each(AI_ACTIONS.map((a) => [a]))('%s: the demo answer passes the real output schema', (action) => {
    const def = ACTION_DEFS[action];
    const step = demoAnswer({ model: 'm', system: '', user, schemaName: def.schemaName, jsonSchema: {}, maxOutputTokens: 100, temperature: 0 });
    if (!('json' in step)) throw new Error('demo must answer with json');
    const parsed = def.schema.safeParse(parseModelJson(JSON.stringify(step.json)));
    expect(parsed.success).toBe(true);
  });

  it('is impossible in release builds, even with the switch on', async () => {
    const w = await flowWorld({ isDev: false });
    await w.ui.gate.setFakeMode(true);
    expect(await w.ui.isDemo()).toBe(false);
    expect(await w.ui.activeEngine()).toBe(w.ui.engine);
  });

  it('in dev builds it runs the real flow with fake answers and labels it DEMO', async () => {
    const w = await flowWorld({ isDev: true, adult: true, consent: true, groqKey: true });
    await w.ui.gate.setFakeMode(true);
    expect(await w.ui.isDemo()).toBe(true);
    const p = w.ui.flow.start(w.ctx(), true).catch(() => undefined);
    await flush();
    expect(w.ui.flow.getSnapshot().demo).toBe(true);
    await w.ui.flow.chooseAction('beautify');
    await flush();
    expect(w.ui.flow.getSnapshot().step.name).toBe('preview');
    expect(w.ui.flow.getSnapshot().rows[0]?.afterText).toContain('(demo)');
    expect(w.groq.calls).toHaveLength(0); // the real adapter was not used
    expect(w.fetchFn).not.toHaveBeenCalled();
    // Demo usage is counted in memory only.
    expect(w.files.get('usage.json')?.content ?? null).toBeNull();
    w.ui.flow.close();
    await p;
  });
});
