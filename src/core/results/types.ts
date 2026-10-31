import * as z from 'zod';

/** The spikes that P0 measures. */
export const SPIKES = ['editor', 'export', 'review', 'voice', 'timestamps', 'ink'] as const;
export type SpikeId = (typeof SPIKES)[number];

export const RUNTIMES = ['expo-go', 'dev-build', 'standalone', 'unknown'] as const;

const metricKey = z.string().regex(/^[a-zA-Z0-9_]{1,40}$/);
const metricValue = z.union([z.number(), z.boolean(), z.string().max(200)]);

/**
 * One measured run of a spike. Results contain METRICS ONLY: no note text,
 * no transcripts, no file paths, no keys. That keeps the log safe to copy
 * into a chat or a bug report.
 */
export const spikeResultSchema = z.object({
  id: z.string().regex(/^r_[A-Za-z0-9]{10,32}$/),
  spike: z.enum(SPIKES),
  at: z.string().max(40),
  verdict: z.enum(['pass', 'fail', 'info']),
  summary: z.string().max(200),
  device: z.object({
    os: z.enum(['android', 'ios', 'web', 'other']),
    osVersion: z.string().max(40),
    model: z.string().max(80),
    runtime: z.enum(RUNTIMES),
    isTablet: z.boolean(),
  }),
  metrics: z.record(metricKey, metricValue).refine((m) => Object.keys(m).length <= 40, 'too many metrics'),
});
export type SpikeResult = z.infer<typeof spikeResultSchema>;
export type DeviceInfo = SpikeResult['device'];
export type Metrics = SpikeResult['metrics'];
