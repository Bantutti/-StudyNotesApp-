import type { IdGenerator } from '../ids';
import type { Logger } from '../logger';
import { spikeResultSchema, type DeviceInfo, type Metrics, type SpikeId, type SpikeResult } from './types';

/** Minimal text-file port so the store is testable without a device. */
export interface TextFilePort {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}

export interface ResultsStore {
  record(input: {
    spike: SpikeId;
    verdict: SpikeResult['verdict'];
    summary: string;
    metrics: Metrics;
  }): Promise<SpikeResult>;
  list(): Promise<SpikeResult[]>;
  clear(): Promise<void>;
}

export const MAX_RESULTS = 500;

export function createResultsStore(deps: {
  file: TextFilePort;
  ids: IdGenerator;
  device: DeviceInfo;
  logger: Logger;
  now?: () => Date;
}): ResultsStore {
  const now = deps.now ?? (() => new Date());

  const readAll = async (): Promise<SpikeResult[]> => {
    const raw = await deps.file.read();
    if (!raw) return [];
    const out: SpikeResult[] = [];
    let skipped = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = spikeResultSchema.safeParse(JSON.parse(line));
        if (parsed.success) out.push(parsed.data);
        else skipped++;
      } catch {
        skipped++;
      }
    }
    if (skipped) deps.logger.warn('results.skipped_invalid_lines', { count: skipped });
    return out;
  };

  return {
    async record(input) {
      const result = spikeResultSchema.parse({
        id: deps.ids.newId('r'),
        at: now().toISOString(),
        device: deps.device,
        ...input,
        summary: input.summary.slice(0, 200),
      });
      const all = [...(await readAll()), result].slice(-MAX_RESULTS);
      await deps.file.write(all.map((r) => JSON.stringify(r)).join('\n') + '\n');
      deps.logger.info('results.recorded', { spike: result.spike, verdict: result.verdict });
      return result;
    },
    list: readAll,
    async clear() {
      await deps.file.write('');
    },
  };
}

/** Markdown report for pasting back into a chat or issue. */
export function resultsToMarkdown(results: readonly SpikeResult[]): string {
  if (results.length === 0) return 'No spike results recorded yet.';
  const lines: string[] = ['# P0 spike results', ''];
  for (const r of results) {
    const d = r.device;
    lines.push(`## ${r.spike}: ${r.verdict.toUpperCase()} (${r.at})`);
    lines.push(`${r.summary}`);
    lines.push(`Device: ${d.model}, ${d.os} ${d.osVersion}, ${d.runtime}${d.isTablet ? ', tablet' : ''}`);
    lines.push('');
    lines.push('| metric | value |', '|---|---|');
    for (const [k, v] of Object.entries(r.metrics)) lines.push(`| ${k} | ${String(v).replace(/\|/g, '/')} |`);
    lines.push('');
  }
  return lines.join('\n');
}
