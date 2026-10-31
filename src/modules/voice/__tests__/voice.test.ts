import { createLogger, memorySink } from '@/core';

import { checkStructure, driftStats, pickTargets, wordAt, type TimedWord } from '../drift';
import { judgeRecording, summarize, type Sample } from '../session';
import { createGroqTranscriber, GROQ_BASE, GROQ_MAX_UPLOAD_BYTES } from '../transcription/groq';
import { normalizeWords, wordErrorRate } from '../wer';

const KEY = 'gsk_' + 'a'.repeat(52);
const sample = (min: number, durMin: number, extra: Partial<Sample> = {}): Sample => ({
  wallMs: min * 60_000, durationMs: durMin * 60_000, fileSize: durMin * 240_000, battery: 1 - min / 600, appState: 'background', paused: false, ...extra,
});

describe('recording session', () => {
  it('a continuous 90-minute background recording passes', () => {
    const samples = Array.from({ length: 91 }, (_, i) => sample(i, i, { appState: i === 0 ? 'active' : 'background' }));
    const s = summarize(samples);
    expect(s.coverage).toBeCloseTo(1, 5);
    expect(s.maxGapMs).toBe(0);
    expect(s.backgroundTransitions).toBe(1);
    expect(s.projected90MinMB).toBeCloseTo(21.6, 1);
    expect(s.batteryPerHourPct).toBeCloseTo(10, 1);
    expect(judgeRecording(s).verdict).toBe('pass');
  });
  it('detects recording that stopped in the background', () => {
    const s = summarize([sample(0, 0, { appState: 'active' }), sample(1, 1), sample(30, 1), sample(31, 2)]);
    expect(s.maxGapMs).toBe(29 * 60_000);
    expect(s.coverage).toBeLessThan(0.1);
    expect(judgeRecording(s).verdict).toBe('fail');
  });
  it('excludes user pauses from coverage', () => {
    const s = summarize([sample(0, 0), sample(10, 10, { paused: true }), sample(20, 10), sample(30, 20)]);
    expect(s.activeWallMs).toBe(20 * 60_000);
    expect(s.coverage).toBeCloseTo(1, 5);
  });
  it('handles empty input', () => {
    expect(summarize([]).samples).toBe(0);
  });
});

describe('word error rate', () => {
  it('is 0 for identical text, ignoring case and punctuation', () => {
    expect(wordErrorRate('Osmosis, diffusion!', 'osmosis diffusion').wer).toBe(0);
  });
  it('counts substitutions, deletions and insertions', () => {
    const r = wordErrorRate('a b c d', 'a x c d e');
    expect(r).toMatchObject({ substitutions: 1, deletions: 0, insertions: 1, refWords: 4 });
    expect(r.wer).toBe(0.5);
  });
  it('normalises hyphens and keeps accented letters', () => {
    expect(normalizeWords('Pag-uusapan natin ang Niño')).toEqual(['pag', 'uusapan', 'natin', 'ang', 'niño']);
    expect(wordErrorRate('mo-shrink kini', 'mo shrink kini').wer).toBe(0);
  });
});

describe('timestamps', () => {
  const words: TimedWord[] = Array.from({ length: 60 }, (_, i) => ({ word: i % 3 ? 'membrane' : 'a', start: i * 0.5, end: i * 0.5 + 0.4 }));
  it('checks ordering and bounds', () => {
    expect(checkStructure(words, 30)).toMatchObject({ ordered: true, withinAudio: true, zeroLength: 0 });
    expect(checkStructure([{ word: 'x', start: 2, end: 1 }], 5).ordered).toBe(false);
    expect(checkStructure([{ word: 'x', start: 1, end: 99 }], 5).withinAudio).toBe(false);
  });
  it('picks spaced, long-enough target words', () => {
    const t = pickTargets(words, 5, 2.5);
    expect(t.length).toBeGreaterThan(0);
    for (let i = 1; i < t.length; i++) expect(words[t[i]!]!.start - words[t[i - 1]!]!.start).toBeGreaterThanOrEqual(2.5);
    expect(t.every((i) => words[i]!.word.length >= 4)).toBe(true);
  });
  it('summarises tap offsets and finds the playing word', () => {
    expect(driftStats([0.2, 0.25, 0.3, 0.22, 1.5])).toMatchObject({ taps: 5, medianOffsetMs: 250, madMs: 50 });
    expect(wordAt(words, 1.1)).toBe(2);
    expect(wordAt(words, -1)).toBe(-1);
  });
});

describe('Groq adapter', () => {
  const okBody = { text: 'hello world', language: 'english', duration: 2, words: [{ word: 'hello', start: 0, end: 0.5 }], segments: [{ start: 0, end: 1, text: 'hello world' }], x_groq: { id: 'x' } };
  const req = { fileUri: 'file:///rec.m4a', fileName: 'rec-20261101T101500.m4a', mimeType: 'audio/m4a' as const, language: 'en' as const, prompt: 'osmosis' };
  const make = (fetchFn: typeof fetch, opts: { key?: string | null; size?: number | null } = {}) => {
    const sink = memorySink();
    const t = createGroqTranscriber({
      getKey: async () => (opts.key === undefined ? KEY : opts.key),
      fetchFn,
      fileSize: () => (opts.size === undefined ? 1000 : opts.size),
      logger: createLogger({ sink, minLevel: 'debug' }),
      timeoutMs: 50,
    });
    return { t, sink };
  };
  const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

  it('sends the key only to the fixed Groq endpoint and parses the response', async () => {
    const calls: { url: string; auth: string }[] = [];
    const { t, sink } = make(async (url, init) => {
      calls.push({ url: String(url), auth: String((init?.headers as Record<string, string>).Authorization) });
      return res(200, okBody);
    });
    const r = await t.transcribe(req);
    expect(calls).toEqual([{ url: `${GROQ_BASE}/audio/transcriptions`, auth: `Bearer ${KEY}` }]);
    expect(r).toMatchObject({ text: 'hello world', durationSec: 2, words: [{ word: 'hello', start: 0, end: 0.5 }] });
    expect(JSON.stringify(sink.records)).not.toContain('gsk_');
    expect(JSON.stringify(sink.records)).not.toContain('hello world');
  });
  it('requires a key and a file under 25 MB', async () => {
    await expect(make(async () => res(200, okBody), { key: null }).t.transcribe(req)).rejects.toMatchObject({ code: 'missing_key' });
    await expect(make(async () => res(200, okBody), { size: GROQ_MAX_UPLOAD_BYTES + 1 }).t.transcribe(req)).rejects.toMatchObject({ code: 'too_large' });
    await expect(make(async () => res(200, okBody), { size: null }).t.transcribe(req)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('rejects unsafe file names', async () => {
    await expect(make(async () => res(200, okBody)).t.transcribe({ ...req, fileName: '../../etc/passwd' })).rejects.toMatchObject({ code: 'validation_failed' });
  });
  it('maps HTTP errors without exposing the body', async () => {
    const cases: [number, string][] = [[401, 'invalid_key'], [413, 'too_large'], [429, 'rate_limited'], [500, 'provider_error']];
    for (const [status, code] of cases) {
      await expect(make(async () => res(status, { error: { message: 'echo gsk_secret' } })).t.transcribe(req)).rejects.toMatchObject({ code });
    }
  });
  it('rejects malformed responses', async () => {
    await expect(make(async () => res(200, { words: 'nope' })).t.transcribe(req)).rejects.toMatchObject({ code: 'provider_error' });
  });
  it('times out', async () => {
    const hang = (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(make(hang as typeof fetch).t.transcribe(req)).rejects.toMatchObject({ code: 'timeout' });
  });
  it('tests the key', async () => {
    expect(await make(async () => res(200, {})).t.testKey()).toBe(true);
    expect(await make(async () => res(401, {})).t.testKey()).toBe(false);
  });
});
