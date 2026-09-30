import { correctnessGate, reproducibilityGate } from './gates';
import type { BehaviorEvidence, DeterminismEvidence, TimingEvidence } from './telemetry';
import type { DecisionTrace } from './decisionTrace';
import type { LocalPlayerEvidence } from './localPlayerInput';
import type { GrifballPhase } from '../grifballMatch';
import type { TeamEvaluationMetrics } from '../grifballEvaluation';
import { freeze } from './plan';
import { aggregateSuiteReport } from './report';
import type { CheckResult, FrozenCase, SuitePlan, ValidationJob } from './types';

export type TrialTermination = 'match-end' | 'scenario-complete' | 'simulation-cap' | 'watchdog' | 'cancelled' | 'invalid-state' | 'setup-error';
export interface TrialFrame {
  tick: number; phase: GrifballPhase; round: number; scores: { blue: number; red: number };
  clock: number; holder: string | null; ballState: string; alive: string[];
}
/** Additive diagnostic contract; absent in older reports and never counted as a valid frame. */
export interface TrialFailureState {
  version: 1;
  stage: 'setup' | 'before-tick' | 'tick' | 'after-tick' | 'sampling';
  tick: number; lastValidTick: number | null;
  ball: { state: string | null; holderId: string | null; position: (number | string | null)[] };
  holder: { id: string; hp: number | string | null; respawnTimer: number | string | null; weapon: string | null } | null;
  actors: { id: string; hp: number | string | null; respawnTimer: number | string | null; position: (number | string | null)[] }[];
  omittedActors: number;
  captureError?: string;
}
export interface TrialResult {
  jobId: string; termination: TrialTermination; check: CheckResult;
  start: TrialFrame | null; end: TrialFrame | null;
  trace: TrialFrame[]; droppedTraceEntries: number;
  failureState?: TrialFailureState;
  behavior?: BehaviorEvidence;
  deterministic?: DeterminismEvidence;
  timings?: TimingEvidence;
  decisions?: DecisionTrace;
  localPlayer?: LocalPlayerEvidence;
  metrics: Record<'blue' | 'red', TeamEvaluationMetrics> | null;
  simulationCost: { samples: number; meanMs: number; maxMs: number };
}
export interface TrialHandle {
  done: Promise<TrialResult>;
  stop: (reason: TrialTermination, message?: string) => TrialResult;
  dispose: () => void;
}
export interface ValidationHost {
  /** Resolve only after the arena, exact roster and every actor mesh are ready. */
  load: (fixture: FrozenCase, job: ValidationJob, signal: AbortSignal) => Promise<TrialHandle>;
  unload: () => void;
}
export function trialCheck(id: string, reason: TrialTermination, message: string): CheckResult {
  const completed = reason === 'match-end' || reason === 'scenario-complete' || reason === 'simulation-cap';
  return { id, state: completed ? 'completed' : reason === 'cancelled' ? 'cancelled' : 'error',
    verdict: reason === 'simulation-cap' || reason === 'cancelled' ? 'inconclusive' : completed ? 'pass' : 'fail',
    summary: message.slice(0, 500) || reason, evidence: [`trial:${id}`] };
}
function unfinished(job: ValidationJob, termination: TrialTermination, message: string): TrialResult {
  return { jobId: job.id, termination, check: trialCheck(job.id, termination, message), start: null, end: null,
    trace: [], droppedTraceEntries: 0, metrics: null, simulationCost: { samples: 0, meanMs: 0, maxMs: 0 } };
}
export interface SuiteProgress { stage: 'loading' | 'running' | 'finished'; jobId: string | null; completed: number; total: number }

/** One live job at a time. Wall timers cover both arena loading and simulation stalls. */
export async function runValidationSuite(plan: SuitePlan, host: ValidationHost, options: {
  signal?: AbortSignal; jobIds?: readonly string[]; onProgress?: (progress: SuiteProgress) => void;
  /** Await checkpoints/pause outside the job watchdog, after the previous arena was disposed. */
  beforeJob?: (job: ValidationJob) => Promise<void>;
  onResult?: (result: TrialResult) => Promise<void>;
} = {}) {
  if (options.jobIds && (new Set(options.jobIds).size !== options.jobIds.length ||
    options.jobIds.some(id => !plan.jobs.some(job => job.id === id)))) throw new Error('Unknown or duplicate selected job');
  const jobs = options.jobIds ? plan.jobs.filter(job => options.jobIds!.includes(job.id)) : plan.jobs;
  const results: TrialResult[] = [];
  for (const job of jobs) {
    if (options.signal?.aborted) break;
    if (options.beforeJob) await options.beforeJob(job);
    if (options.signal?.aborted) break;
    const fixture = plan.cases.find(c => c.specification.id === job.caseId && c.inputHash === job.inputHash);
    if (!fixture) throw new Error(`Missing frozen fixture for ${job.id}`);
    const abort = new AbortController();
    let handle: TrialHandle | undefined;
    let interrupted: TrialTermination = 'cancelled';
    let cleanupFailure: unknown;
    const cancel = () => abort.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { interrupted = 'watchdog'; abort.abort(); }, job.watchdogSeconds * 1000);
    const interruption = new Promise<TrialResult>(resolve => abort.signal.addEventListener('abort', () => {
      const message = interrupted === 'watchdog' ? 'Wall-clock watchdog expired (including arena loading).' : 'Suite cancelled.';
      resolve(handle?.stop(interrupted, message) ?? unfinished(job, interrupted, message));
    }, { once: true }));
    try {
      options.onProgress?.({ stage: 'loading', jobId: job.id, completed: results.length, total: jobs.length });
      const work = (async () => {
        handle = await host.load(fixture, job, abort.signal);
        if (abort.signal.aborted) {
          const result = handle.stop(interrupted); handle.dispose(); return result;
        }
        options.onProgress?.({ stage: 'running', jobId: job.id, completed: results.length, total: jobs.length });
        return await handle.done;
      })();
      results.push(await Promise.race([work, interruption]));
    } catch (error) {
      results.push(handle?.stop('setup-error', String(error)) ?? unfinished(job, 'setup-error', String(error)));
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      abort.abort();
      try { handle?.dispose(); } catch (error) { cleanupFailure = error; }
      try { host.unload(); } catch (error) { cleanupFailure ??= error; }
      if (cleanupFailure) {
        const previous = results.at(-1)!;
        results[results.length - 1] = { ...previous, termination: 'setup-error',
          check: trialCheck(job.id, 'setup-error', `Cleanup failed: ${String(cleanupFailure)}`) };
      }
    }
    await options.onResult?.(results.at(-1)!);
    if (options.signal?.aborted || cleanupFailure) break;
  }
  options.onProgress?.({ stage: 'finished', jobId: null, completed: results.length, total: jobs.length });
  // Browser execution checks observed behavior; pinned runtime and repository evidence belong to the CLI.
  const report = aggregateSuiteReport(plan, { planId: plan.id, jobs: results.map(r => r.check),
    gates: [correctnessGate(plan, results).check, reproducibilityGate(plan, results, false).check] });
  return freeze({ schemaVersion: 1 as const, planId: plan.id, plan, results, report });
}
