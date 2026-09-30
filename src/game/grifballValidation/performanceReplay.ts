import { deterministicTrialValue, finished, indexResults } from './gates';
import { canonicalJSON } from './plan';
import { assertPlannerRefreshTrace } from './telemetry';
import type { TrialResult } from './runner';
import type { SuitePlan } from './types';

export interface PerformanceReplay {
  planId: string;
  environmentHash: string;
  results: readonly TrialResult[];
}
export interface ReplayWindow { firstTick: number; lastTick: number; samples: number; originalMs: number; replayMs: number; ratio: number | null }

/** Compare equal work in fixed, non-overlapping windows, including the final tail.
 * Summing reduces timer quantization; no window or outlier is trimmed. */
export function alignedReplayWindows(original: TrialResult, replay: TrialResult, width: number): ReplayWindow[] {
  if (!Number.isInteger(width) || width < 2 || width > 64) throw new Error('Invalid replay window width');
  for (const trial of [original, replay]) {
    if (!finished(trial) || trial.check.verdict === 'fail' || !trial.start || !trial.end || !trial.behavior ||
      !trial.deterministic || !/^[a-f0-9]{64}$/.test(trial.deterministic.hash ?? '') || trial.deterministic.error ||
      trial.deterministic.ticks !== trial.end.tick + 1) throw new Error('Incomplete deterministic replay');
    const timing = trial.timings;
    if (!timing || timing.version !== 2 || timing.warmupBasis !== 'playing-ticks' || timing.dropped ||
      !timing.plannerRefreshTrace || timing.plannerRefreshTrace.dropped) throw new Error('Incomplete aligned timing trace');
    assertPlannerRefreshTrace(timing);
  }
  if (canonicalJSON(deterministicTrialValue(original)) !== canonicalJSON(deterministicTrialValue(replay)))
    throw new Error('Performance replay changed deterministic gameplay');
  const a = original.timings!.plannerRefreshTrace!.samples, b = replay.timings!.plannerRefreshTrace!.samples;
  if (a.length !== b.length || a.some((sample, i) => sample[0] !== b[i][0])) throw new Error('Performance replay refresh ticks differ');
  const windows: ReplayWindow[] = [];
  for (let start = 0; start < a.length; start += width) {
    const end = Math.min(a.length, start + width);
    let originalMs = 0, replayMs = 0;
    for (let i = start; i < end; i++) { originalMs += a[i][1]; replayMs += b[i][1]; }
    windows.push({ firstTick: a[start][0], lastTick: a[end - 1][0], samples: end - start, originalMs, replayMs,
      ratio: Math.min(originalMs, replayMs) > 0 ? Math.max(originalMs, replayMs) / Math.min(originalMs, replayMs) : null });
  }
  return windows;
}

export function indexPerformanceReplay(plan: SuitePlan, environmentHash: string | null, replay?: PerformanceReplay) {
  if (!replay || !environmentHash || replay.planId !== plan.id || replay.environmentHash !== environmentHash)
    throw new Error('Missing performance replay or different plan/environment');
  return indexResults(plan, replay.results);
}
