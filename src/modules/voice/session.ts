/**
 * Long-recording session monitor (pure, unit-tested).
 *
 * The key question for the 90-minute spike: does the native recorder keep
 * going when the app is backgrounded or the screen is locked? We compare
 * the recorder's own duration with wall-clock time. If recording stopped
 * in the background, duration falls behind the clock and shows up as a gap.
 */
export type AppStateName = 'active' | 'background' | 'inactive' | 'unknown';

export interface Sample {
  wallMs: number;
  durationMs: number;
  fileSize: number;
  battery: number | null; // 0..1
  appState: AppStateName;
  paused: boolean;
}

export interface SessionSummary {
  wallMs: number;
  activeWallMs: number; // excludes user pauses
  recordedMs: number;
  coverage: number; // recordedMs / activeWallMs
  maxGapMs: number;
  backgroundMs: number;
  backgroundTransitions: number;
  fileSize: number;
  bytesPerMinute: number;
  projected90MinMB: number;
  batteryStart: number | null;
  batteryEnd: number | null;
  batteryPerHourPct: number | null;
  samples: number;
}

export const GAP_TOLERANCE_MS = 2_000;

export function summarize(samples: readonly Sample[]): SessionSummary {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) {
    return {
      wallMs: 0, activeWallMs: 0, recordedMs: 0, coverage: 0, maxGapMs: 0, backgroundMs: 0,
      backgroundTransitions: 0, fileSize: 0, bytesPerMinute: 0, projected90MinMB: 0,
      batteryStart: null, batteryEnd: null, batteryPerHourPct: null, samples: 0,
    };
  }
  let pausedMs = 0;
  let maxGapMs = 0;
  let backgroundMs = 0;
  let transitions = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as Sample;
    const b = samples[i] as Sample;
    const wall = b.wallMs - a.wallMs;
    if (a.paused) {
      pausedMs += wall;
      continue;
    }
    const gap = wall - (b.durationMs - a.durationMs);
    if (gap > GAP_TOLERANCE_MS) maxGapMs = Math.max(maxGapMs, gap);
    if (a.appState !== 'active') backgroundMs += wall;
    if (a.appState === 'active' && b.appState !== 'active') transitions++;
  }
  const wallMs = last.wallMs - first.wallMs;
  const activeWallMs = Math.max(0, wallMs - pausedMs);
  const recordedMs = last.durationMs - first.durationMs;
  const minutes = recordedMs / 60_000;
  const bytesPerMinute = minutes > 0 ? last.fileSize / minutes : 0;
  const hours = wallMs / 3_600_000;
  const batteryPerHourPct =
    first.battery !== null && last.battery !== null && hours > 0.05
      ? ((first.battery - last.battery) * 100) / hours
      : null;
  return {
    wallMs,
    activeWallMs,
    recordedMs,
    coverage: activeWallMs > 0 ? Math.min(1, recordedMs / activeWallMs) : 0,
    maxGapMs,
    backgroundMs,
    backgroundTransitions: transitions,
    fileSize: last.fileSize,
    bytesPerMinute,
    projected90MinMB: (bytesPerMinute * 90) / 1_000_000,
    batteryStart: first.battery,
    batteryEnd: last.battery,
    batteryPerHourPct,
    samples: samples.length,
  };
}

export interface RecordingVerdict {
  verdict: 'pass' | 'fail' | 'info';
  reasons: string[];
}

/** Pass = 85+ minutes, 98%+ coverage, tested in background, fits Whisper's 25 MB. */
export function judgeRecording(s: SessionSummary): RecordingVerdict {
  const reasons: string[] = [];
  if (s.recordedMs < 85 * 60_000) reasons.push('shorter than 85 minutes (info only)');
  if (s.backgroundMs < 60_000) reasons.push('less than 1 minute in background (lock the screen during the test)');
  if (s.coverage < 0.98) reasons.push(`coverage ${(s.coverage * 100).toFixed(1)}% is below 98%`);
  if (s.maxGapMs > 10_000) reasons.push(`a ${Math.round(s.maxGapMs / 1000)} s gap was detected`);
  if (s.projected90MinMB > 25) reasons.push('90 minutes would exceed the 25 MB upload limit');
  const hardFail = s.coverage < 0.98 || s.maxGapMs > 10_000;
  const complete = s.recordedMs >= 85 * 60_000 && s.backgroundMs >= 60_000 && s.projected90MinMB <= 25;
  return { verdict: hardFail ? 'fail' : complete ? 'pass' : 'info', reasons };
}
