import { canonicalJSON, createSuitePlan } from './plan';
import { validLocalPlayerEvidence } from './localPlayerInput';
import type { TrialResult } from './runner';
import type { CheckResult, Gate, SuitePlan, Verdict } from './types';
export interface GateEvaluation { check: CheckResult; details: unknown }
export function gate(id: Gate, verdict: Verdict, summary: string, details: unknown): GateEvaluation {
  return { check: { id, state: verdict === 'not-run' ? 'queued' : 'completed', verdict, summary,
    evidence: verdict === 'not-run' ? [] : [`gates/${id}.json`] }, details };
}
export function nullControlRequired(plan: SuitePlan) { return canonicalJSON(plan.manifest.baseline) !== canonicalJSON(plan.manifest.candidate); }
export async function createNullControlPlan(plan: SuitePlan) {
  return createSuitePlan({ ...plan.manifest, candidate: plan.manifest.baseline }, plan.code);
}
export function indexResults(plan: SuitePlan, results: readonly TrialResult[]) {
  const indexed = new Map<string, TrialResult>();
  for (const result of results) {
    if (indexed.has(result.jobId) || !plan.jobs.some(j => j.id === result.jobId)) throw new Error('Duplicate or foreign gate evidence');
    indexed.set(result.jobId, result);
  }
  return indexed;
}
export const finished = (r: TrialResult | undefined) => r && ['match-end', 'scenario-complete', 'simulation-cap'].includes(r.termination);
export function correctnessGate(plan: SuitePlan, results: readonly TrialResult[]): GateEvaluation {
  if (!results.length) return gate('correctness', 'not-run', 'No live trials have run.', null);
  const indexed = indexResults(plan, results), failures: string[] = [], missing: string[] = [];
  for (const job of plan.jobs) {
    const r = indexed.get(job.id), fixture = plan.cases.find(c => c.specification.id === job.caseId)!;
    const scenario = fixture.specification.scenario;
    if (r?.check.verdict === 'fail') { failures.push(`${job.id}: ${r.check.summary}`); continue; }
    if (!finished(r) || !r!.behavior || !r!.end || r!.behavior.ticks !== r!.end.tick) { missing.push(job.id); continue; }
    const b = r!.behavior!;
    if (fixture.observer === 'local-input') {
      const e = r!.localPlayer;
      if (e === undefined) missing.push(`${job.id}: local player observation missing`);
      else if (!validLocalPlayerEvidence(e, job.simulationTicks) || e.inputTicks !== r!.end!.tick ||
        !r!.start?.alive.includes('player') || e.possessions > b.pickups || e.respawns > b.respawns ||
        e.respawns > e.deaths || e.goals > b.goals[job.focalTeam])
        failures.push(`${job.id}: incoherent local player observation`);
    } else if (r!.localPlayer !== undefined) failures.push(`${job.id}: local observation outside owned roster`);
    if (b.staleRoleTicks) failures.push(`${job.id}: dead actor retained a role for more than 60 ticks`);
    if (scenario === 'pickup' && !b.pickups) failures.push(`${job.id}: no pickup`);
    if (scenario === 'goal' && !b.goals[job.focalTeam]) failures.push(`${job.id}: focal runner did not score`);
    if (scenario === 'reinforcements' && !b.respawns) failures.push(`${job.id}: reinforcement did not respawn`);
    if (scenario === 'pass' && (!b.throws || !b.recoveries)) failures.push(`${job.id}: pass was not thrown and recovered`);
  }
  return gate('correctness', failures.length ? 'fail' : missing.length ? 'inconclusive' : 'pass',
    `${failures.length} behavior/invariant failures; ${missing.length} jobs without complete observation.`,
    { protocol: 'live-invariants-and-expectations-v2', scope: 'All-tick ownership, finite state, legal score/lifecycle, dead-role release; pickup, goal, pass recovery and reinforcement scenario expectations; coherent local observations for mixed matches.', failures, missing });
}
/** Exact same-runtime comparison. Timings and bounded UI trace truncation are excluded. */
export function reproducibilityGate(plan: SuitePlan, results: readonly TrialResult[], pinnedRuntime: boolean): GateEvaluation {
  if (!results.length) return gate('reproducibility', 'not-run', 'No null trials have run.', null);
  if (nullControlRequired(plan)) return gate('reproducibility', 'inconclusive', 'Run an identical-config null control before comparing different configurations.', null);
  const indexed = indexResults(plan, results), failures: string[] = [], missing: string[] = []; let pairs = 0;
  for (const a of plan.jobs.filter(j => j.variant === 'baseline')) {
    const b = plan.jobs.find(j => j.variant === 'candidate' && j.caseId === a.caseId && j.seed === a.seed && j.opponent === a.opponent && j.mirrored === a.mirrored)!;
    const x = indexed.get(a.id), y = indexed.get(b.id);
    if (x?.check.verdict === 'fail' || y?.check.verdict === 'fail') { failures.push(`${a.id}: failed control trial`); continue; }
    if (!finished(x) || !finished(y) || !x!.deterministic?.hash || !y!.deterministic?.hash ||
      x!.deterministic.ticks !== (x!.end?.tick ?? -2) + 1 || y!.deterministic.ticks !== (y!.end?.tick ?? -2) + 1) { missing.push(a.id); continue; }
    if (plan.cases.find(c => c.specification.id === a.caseId)!.observer === 'local-input') {
      if (x!.localPlayer === undefined || y!.localPlayer === undefined) { missing.push(`${a.id}: local player observation missing`); continue; }
      if ([x!, y!].some(r => !validLocalPlayerEvidence(r.localPlayer, a.simulationTicks) || r.localPlayer!.inputTicks !== r.end!.tick)) {
        failures.push(`${a.id}: malformed local player observation`); continue;
      }
    }
    pairs++;
    const value = (r: TrialResult) => ({ termination: r.termination, start: r.start, end: r.end,
      deterministic: r.deterministic, behavior: r.behavior, metrics: r.metrics,
      ...(r.localPlayer !== undefined ? { localPlayer: r.localPlayer } : {}) });
    if (canonicalJSON(value(x!)) !== canonicalJSON(value(y!))) failures.push(a.id);
  }
  return gate('reproducibility', failures.length ? 'fail' : missing.length || !pinnedRuntime ? 'inconclusive' : 'pass',
    `${pairs} null pairs compared; ${failures.length} mismatches; ${missing.length} missing pairs.${pinnedRuntime ? '' : ' Runtime is not pinned.'}`,
    { protocol: 'exact-sha256-pages-v1', numericTolerance: 0, pinnedRuntime, pairs, failures, missing });
}
/** Frozen before execution; these are operator declarations, not proof of an idle machine. */
export interface GateProtocol {
  version: 1;
  quality: { tuningSeeds: number[]; tuningMapIds: string[] } | null;
  performance: { calibrationId: string; environmentHash: string; controlledSerial: true;
    maxBaselineRatio: number; maxNoiseRatio: number; minRefreshSamples: number } | null;
}
export function validateGateProtocol(raw: unknown): GateProtocol {
  const p = raw as GateProtocol;
  if (!p || p.version !== 1 || !Object.hasOwn(p, 'quality') || !Object.hasOwn(p, 'performance')) throw new Error('Expected a version 1 gate protocol');
  if (p.quality && (!Array.isArray(p.quality.tuningSeeds) || p.quality.tuningSeeds.some(n => !Number.isInteger(n) || n < 0 || n > 0xffffffff) ||
    !Array.isArray(p.quality.tuningMapIds) || p.quality.tuningMapIds.some(id => typeof id !== 'string' || !id))) throw new Error('Invalid tuning ledger');
  if (p.performance && (typeof p.performance.calibrationId !== 'string' || !p.performance.calibrationId ||
    !/^[a-f0-9]{64}$/.test(p.performance.environmentHash) || p.performance.controlledSerial !== true ||
    !Number.isFinite(p.performance.maxBaselineRatio) || p.performance.maxBaselineRatio < 1 ||
    !Number.isFinite(p.performance.maxNoiseRatio) || p.performance.maxNoiseRatio < 1 ||
    !Number.isInteger(p.performance.minRefreshSamples) || p.performance.minRefreshSamples < 20)) throw new Error('Invalid performance calibration');
  return structuredClone(p);
}
