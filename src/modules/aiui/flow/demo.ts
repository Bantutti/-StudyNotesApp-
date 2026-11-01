/**
 * "Demo AI" for development builds only: P3a's fake adapter with a script
 * that answers every action from the note's own text, so the whole flow
 * (wizard, consent, preview, apply, undo) can be tried in Expo Go without a
 * key or network. Every screen shows a DEMO label while it is on, and the
 * answers say "(demo)" so they can never be mistaken for real AI output.
 *
 * It is never available in release builds (the factory ignores the switch
 * when isDev is false; tested).
 */
import { createFakeProvider, type ChatRequest, type FakeProvider, type FakeStep, type Provider } from '@/modules/ai';

interface DemoUnit {
  ref: string;
  kind: string;
  term: string | null;
  text: string;
  readOnly: boolean;
}

/** Reads the JSON lines between <note_blocks> tags (the engine's own escaped format). */
export function demoUnits(user: string): DemoUnit[] {
  const start = user.indexOf('<note_blocks>');
  const end = user.indexOf('</note_blocks>');
  if (start < 0 || end < 0) return [];
  return user
    .slice(start + '<note_blocks>'.length, end)
    .split('\n')
    .flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const u = JSON.parse(line) as DemoUnit;
        return typeof u.ref === 'string' && typeof u.text === 'string' ? [u] : [];
      } catch {
        return [];
      }
    });
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Strips the five inline marks so demo text stays plain. */
const plain = (s: string) => s.replace(/\*\*|==|~~|\+\+|\*/g, '');

/** Builds a schema-valid answer from the note itself (one request, one step). */
export function demoAnswer(req: ChatRequest): FakeStep {
  const units = demoUnits(req.user);
  const editable = units.filter((u) => !u.readOnly && u.text.trim());
  const first = editable[0];
  switch (req.schemaName) {
    case 'edit_plan':
      return {
        json: {
          units: first
            ? [{ ref: first.ref, op: 'replace', blocks: [{ kind: first.kind, term: first.term, text: `${first.text} (demo)` }] }]
            : [],
        },
      };
    case 'summary':
      return { json: { title: 'Summary (demo)', points: editable.slice(0, 3).map((u) => `${short(plain(u.text), 120)} (demo)`) } };
    case 'key_terms':
      return {
        json: {
          terms: editable.slice(0, 2).map((u) => ({
            term: short(plain(u.term ?? u.text).split(/\s+/)[0] ?? 'Term', 40),
            definition: `${short(plain(u.text), 160)} (demo)`,
            sourceRef: u.ref,
          })),
        },
      };
    case 'explanation':
      return { json: { paragraphs: [`This is a demo explanation of: ${short(plain(first?.text ?? ''), 200)}`] } };
    case 'flashcards':
      return { json: { cards: first ? [{ type: 'basic', front: 'What does this line say? (demo)', back: short(plain(first.text), 200), sourceRef: first.ref }] : [] } };
    case 'quiz':
      return {
        json: { questions: first ? [{ kind: 'short', question: 'Summarise this line. (demo)', choices: [], answerIndex: null, answer: short(plain(first.text), 200), sourceRef: first.ref }] : [] },
      };
    default:
      return { json: {} };
  }
}

/** Fake adapters for both providers, answering with demoAnswer. */
export function createDemoProviders(): Record<Provider, FakeProvider> {
  const step: FakeStep = (req) => demoAnswer(req);
  return { groq: createFakeProvider('groq', [step]), mistral: createFakeProvider('mistral', [step]) };
}
