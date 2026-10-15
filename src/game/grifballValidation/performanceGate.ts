import { finished, gate, indexResults, type GateEvaluation, type GateProtocol } from './gates';
import type { TrialResult } from './runner';
import type { SuitePlan } from './types';
import { alignedReplayWindows, indexPerformanceReplay, type PerformanceReplay } from './performanceReplay';
export function performanceGate(plan: SuitePlan, results: readonly TrialResult[], environmentHash: string | null, protocol?: GateProtocol, replay?: PerformanceReplay): GateEvaluation {
  const budget = plan.manifest.performance, calibration = protocol?.performance;
  const indexed = indexResults(plan, results), rows: unknown[] = [], failures: string[] = [], invalid: string[] = [];
  if (!budget) return gate('performance', 'not-run', 'No calibrated performance budget. Timing distributions remain in trial evidence.', null);
  if (!calibration || calibration.calibrationId !== budget.calibrationId || calibration.environmentHash !== environmentHash)
    invalid.push('Missing calibration or different browser/hardware environment.');
  let repeated: Map<string, TrialResult> | undefined;
  if (protocol?.version === 2) {
    try { repeated = indexPerformanceReplay(plan, environmentHash, replay); }
    catch (error) { invalid.push(String(error)); }
  }
  for (const job of plan.jobs) {
    const r = indexed.get(job.id), timing = r?.timings;
    if (timing && (timing.version !== 2 || timing.warmupBasis !== 'playing-ticks' || timing.playingTicks < timing.warmupTicks))
      invalid.push(`${job.id}: warmup must count actual playing ticks`);
    if (!finished(r) || !timing || timing.dropped || timing.warm.plannerRefresh.samples < (calibration?.minRefreshSamples ?? 20)) { invalid.push(`${job.id}: incomplete warm samples`); continue; }
    if (['snapshot', 'coordination', 'evaluation', 'tick', 'render'].some(c => timing.warm[c as keyof typeof timing.warm].samples < 1)) invalid.push(`${job.id}: incomplete live timing channels`);
    const refresh = timing.warm.plannerRefresh;
    let windows: ReturnType<typeof alignedReplayWindows> | undefined;
    if (protocol?.version === 2) {
      try {
        const repeat = repeated?.get(job.id);
        if (!repeat || !calibration?.noise) throw new Error('Missing calibrated per-job replay');
        windows = alignedReplayWindows(r!, repeat, calibration.noise.windowRefreshes);
        if (windows.length < 2 || windows.some(w => w.ratio === null || w.ratio > calibration.maxNoiseRatio))
          invalid.push(`${job.id}: noisy or unresolved aligned replay windows`);
        const repeatTiming = repeat.timings!;
        if (['snapshot', 'coordination', 'evaluation', 'tick', 'render'].some(c => repeatTiming.warm[c as keyof typeof repeatTiming.warm].samples < 1))
          invalid.push(`${job.id}: incomplete replay timing channels`);
        if (repeatTiming.warm.plannerRefresh.p95Ms > budget.plannerRefreshP95Ms)
          failures.push(`${job.id}: replay p95 exceeds ${budget.plannerRefreshP95Ms}ms`);
      } catch (error) { invalid.push(`${job.id}: ${String(error)}`); }
    } else if (!refresh.p50Ms || refresh.maxMs / refresh.p50Ms > (calibration?.maxNoiseRatio ?? 3)) invalid.push(`${job.id}: noisy measurement environment`);
    if (refresh.p95Ms > budget.plannerRefreshP95Ms) failures.push(`${job.id}: p95 ${refresh.p95Ms}ms exceeds ${budget.plannerRefreshP95Ms}ms`);
    let ratio: number | null = null;
    if (job.variant === 'candidate') {
      const base = plan.jobs.find(j => j.variant === 'baseline' && j.caseId === job.caseId && j.seed === job.seed && j.opponent === job.opponent && j.mirrored === job.mirrored)!;
      const denominator = indexed.get(base.id)?.timings?.warm.plannerRefresh.p95Ms;
      ratio = denominator && denominator > 0 ? refresh.p95Ms / denominator : null;
      if (ratio === null) invalid.push(`${job.id}: missing paired baseline timing`);
      else if (ratio > (calibration?.maxBaselineRatio ?? 1.2)) failures.push(`${job.id}: baseline ratio ${ratio}`);
      if (protocol?.version === 2) {
        const repeatedBase = repeated?.get(base.id)?.timings?.warm.plannerRefresh.p95Ms;
        const repeatedCandidate = repeated?.get(job.id)?.timings?.warm.plannerRefresh.p95Ms;
        if (!repeatedBase || repeatedCandidate === undefined) invalid.push(`${job.id}: missing replay baseline timing`);
        else if (repeatedCandidate / repeatedBase > (calibration?.maxBaselineRatio ?? 1.2)) failures.push(`${job.id}: replay baseline ratio ${repeatedCandidate / repeatedBase}`);
      }
    }
    rows.push({ jobId: job.id, timing, baselineRatio: ratio, ...(windows ? { replayWindows: windows,
      replayTiming: repeated!.get(job.id)!.timings } : {}) });
  }
  return gate('performance', invalid.length ? 'inconclusive' : failures.length ? 'fail' : 'pass',
    invalid.length ? 'Invalid measurement environment or insufficient calibrated samples.' : failures.length ? `${failures.length} absolute/relative budget violations.` : 'Calibrated absolute and paired budgets met.',
    { protocolVersion: protocol?.version ?? null, budget, calibration, environmentHash, invalid, failures, rows });
}
