/** "Report this AI result": local metadata only, capped, deletable (Q10 = A). */
import { createSeqIdGenerator } from '@/core';

import { createReportsStore, MAX_REPORTS, REPORT_COMMENT_MAX, type NewReport } from '../gate/reportsStore';
import { memoryFile, spyLogger } from './helpers';

const base: NewReport = { action: 'beautify', provider: 'groq', models: ['openai/gpt-oss-120b'], promptVersion: 'beautify@1.base@1', reason: 'wrong', comment: '' };

function setup() {
  const file = memoryFile();
  const log = spyLogger();
  const reports = createReportsStore({ file, ids: createSeqIdGenerator(), logger: log.logger, now: () => 1_000 });
  return { file, log, reports };
}

describe('reports store', () => {
  it('saves metadata, newest first', async () => {
    const { reports } = setup();
    await reports.add(base);
    const second = await reports.add({ ...base, reason: 'harmful', comment: '  made up a date  ' });
    const list = await reports.list();
    expect(list.map((r) => r.id)).toEqual([second.id, list[1]?.id]);
    expect(list[0]?.comment).toBe('made up a date');
  });

  it('has no field for note text or AI output (strict schema)', async () => {
    const { reports } = setup();
    await expect(reports.add({ ...base, noteText: 'secret' } as unknown as NewReport)).rejects.toThrow();
  });

  it('rejects an over-long comment instead of cutting it', async () => {
    const { reports } = setup();
    await expect(reports.add({ ...base, comment: 'x'.repeat(REPORT_COMMENT_MAX + 1) })).rejects.toThrow();
    await reports.add({ ...base, comment: 'x'.repeat(REPORT_COMMENT_MAX) });
  });

  it(`keeps at most ${MAX_REPORTS}`, async () => {
    const { reports } = setup();
    for (let i = 0; i < MAX_REPORTS + 5; i++) await reports.add(base);
    expect(await reports.list()).toHaveLength(MAX_REPORTS);
  });

  it('removes one, clears all, and forget() reloads from the file', async () => {
    const { reports, file } = setup();
    const a = await reports.add(base);
    await reports.add(base);
    await reports.remove(a.id);
    expect(await reports.list()).toHaveLength(1);
    await reports.clear();
    expect(await reports.list()).toHaveLength(0);
    await reports.add(base);
    file.content = null;
    reports.forget();
    expect(await reports.list()).toHaveLength(0);
  });

  it('never logs the comment', async () => {
    const { reports, log } = setup();
    await reports.add({ ...base, comment: 'my private remark' });
    expect(log.dump()).not.toContain('private remark');
  });
});
