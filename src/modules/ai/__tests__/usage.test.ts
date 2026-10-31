/** Usage meter (ALGORITHMS §8): per provider per local day, 30-day retention, no content. */
import { createUsageMeter, localDay, RETENTION_DAYS } from '../usage/meter';
import { memFile, testLogger } from './fixtures';

describe('usage meter', () => {
  it('counts requests, failures and tokens per provider per local day', async () => {
    let t = new Date(2026, 10, 1, 23, 59).getTime();
    const file = memFile();
    const m = createUsageMeter({ file, logger: testLogger().logger, now: () => t });
    await m.record({ provider: 'groq', model: 'openai/gpt-oss-120b', ok: true, inputTokens: 100, outputTokens: 50, estimated: false, remainingRequests: 999 });
    await m.record({ provider: 'groq', model: 'openai/gpt-oss-20b', ok: false, failure: 'rate_limited', inputTokens: 0, outputTokens: 0, estimated: false });
    await m.record({ provider: 'mistral', model: 'mistral-small-latest', ok: true, inputTokens: 10, outputTokens: 5, estimated: true });
    const g = await m.today('groq');
    expect(g).toMatchObject({ day: '2026-11-01', requests: 2, ok: 1, failed: { rate_limited: 1 }, rateLimited: 1, inputTokens: 100, outputTokens: 50, remainingRequests: 999 });
    expect(g.byModel).toEqual({ 'openai/gpt-oss-120b': 1, 'openai/gpt-oss-20b': 1 });
    expect((await m.today('mistral')).estimated).toBe(true);
    t += 2 * 60_000; // past local midnight
    expect((await m.today('groq')).requests).toBe(0);
    expect((await m.history('groq')).map((h) => h.day)).toEqual(['2026-11-01']);
  });

  it('survives a corrupt file, prunes old days and serialises concurrent writes', async () => {
    let t = new Date(2026, 10, 1, 12).getTime();
    const file = memFile('{not json');
    const { sink, logger } = testLogger();
    const m = createUsageMeter({ file, logger, now: () => t });
    await Promise.all(Array.from({ length: 20 }, () => m.record({ provider: 'groq', model: 'm', ok: true, inputTokens: 1, outputTokens: 1, estimated: false })));
    expect((await m.today('groq')).requests).toBe(20);
    expect(sink.records.some((r) => r.event === 'usage_file_reset')).toBe(true);
    t += (RETENTION_DAYS + 1) * 86_400_000;
    await m.record({ provider: 'groq', model: 'm', ok: true, inputTokens: 1, outputTokens: 1, estimated: false });
    expect(Object.keys(JSON.parse(file.content as string).days)).toEqual([localDay(t)]);
  });
});
