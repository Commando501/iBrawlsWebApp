import { EVALUATION_METRICS, evaluationValue, estimateSeedDeltas, type EvaluationMetric } from '../grifballEvaluation';
import { gate, indexResults, nullControlRequired, type GateEvaluation, type GateProtocol } from './gates';
import type { TrialResult } from './runner';
import type { CheckResult, SuitePlan, ValidationJob } from './types';
export function qualityGate(plan: SuitePlan, results: readonly TrialResult[], nullCheck: CheckResult, protocol?: GateProtocol): GateEvaluation {
  const policy = plan.manifest.quality;
  if (!policy) return gate('quality', 'not-run', 'No frozen quality hypothesis or evidence minimum.', null);
  const indexed = indexResults(plan, results), cases = plan.cases.filter(c => c.specification.mode === 'match');
  const jobs = plan.jobs.filter(j => cases.some(c => c.specification.id === j.caseId));
  const completed = jobs.filter(j => indexed.get(j.id)?.termination === 'match-end').length;
  const censored = jobs.filter(j => indexed.get(j.id)?.termination === 'simulation-cap').length;
  const issues: string[] = [];
  if (nullCheck.verdict !== 'pass') issues.push('Identical-config control did not pass on a pinned runtime.');
  if (!protocol?.quality) issues.push('Missing predeclared tuning seed/map ledger.');
  if (!cases.length || cases.some(c => !c.specification.mirrored || c.specification.opponents.length !== 3)) issues.push('Full mirrored, three-style match matrix required.');
  if (completed !== jobs.length || !jobs.length) issues.push('Missing, failed or capped matches prevent a complete-match improvement claim.');
  const ledger = protocol?.quality;
  if (ledger && cases.some(c => ledger.tuningMapIds.includes(c.specification.mapId) || c.specification.seeds.some(s => ledger.tuningSeeds.includes(s)))) issues.push('Held-out inputs overlap tuning inputs.');
  const metricKeys = Object.keys(EVALUATION_METRICS) as EvaluationMetric[];
  const metric = (job: ValidationJob, key: EvaluationMetric): number | null => {
    const r = indexed.get(job.id);
    if (r?.termination !== 'match-end' || !r.metrics) return null;
    const value = evaluationValue({ job, metrics: r.metrics }, key);
    return value !== null && Number.isFinite(value) ? value : null;
  };
  const strata = cases.flatMap(c => c.specification.opponents.map(opponent => {
    const base = jobs.filter(j => j.caseId === c.specification.id && j.opponent === opponent && j.variant === 'baseline');
    const measures = Object.fromEntries(metricKeys.map(key => {
      const bySeed = new Map<number, number[]>();
      for (const a of base) {
        const b = jobs.find(j => j.caseId === a.caseId && j.seed === a.seed && j.opponent === a.opponent && j.mirrored === a.mirrored && j.variant === 'candidate')!;
        const x = metric(a, key), y = b ? metric(b, key) : null;
        if (x === null || y === null) continue;
        const values = bySeed.get(a.seed) ?? []; values.push(y - x); bySeed.set(a.seed, values);
      }
      const seedDeltas = [...bySeed].filter(([, v]) => v.length === 2).map(([seed, v]) => ({ seed, delta: (v[0] + v[1]) / 2 }));
      return [key, { estimate: estimateSeedDeltas(seedDeltas.map(v => v.delta), seedDeltas.length * 2), seedDeltas }];
    }));
    return { caseId: c.specification.id, map: c.specification.mapId, opponent, measures };
  }));
  const allSeeds = [...new Set(jobs.map(j => j.seed))].sort((a, b) => a - b);
  const seedDeltas = allSeeds.flatMap(seed => {
    const v = strata.map(s => s.measures.goalMargin.seedDeltas.find(v => v.seed === seed)?.delta);
    return v.length && v.every(x => x !== undefined) ? [{ seed, delta: (v as number[]).reduce((a, b) => a + b, 0) / v.length }] : [];
  });
  const estimate = estimateSeedDeltas(seedDeltas.map(s => s.delta), seedDeltas.length * strata.length * 2);
  if (estimate.seeds < policy.minIndependentSeeds || estimate.seeds !== allSeeds.length) issues.push('Insufficient complete independent seed clusters.');
  if (strata.some(s => metricKeys.some(key => s.measures[key].estimate.seeds < policy.minIndependentSeeds))) issues.push('Supporting metrics lack required opportunities.');
  const improved = estimate.low !== null && estimate.low > policy.minEffect;
  const regression = estimate.high !== null && estimate.high < -policy.minEffect;
  return gate('quality', issues.length ? 'inconclusive' : regression ? 'fail' : improved && nullControlRequired(plan) ? 'pass' : 'inconclusive',
    issues.length ? issues.join(' ') : regression ? 'Goal-margin regression detected.' : improved && nullControlRequired(plan) ? 'Primary effect exceeds the predeclared minimum.' : 'No established improvement over the minimum effect.',
    { protocol: 'paired-seed-t95-v1', weighting: 'Equal case × opponent weights, both sides averaged within seed; all cases must share complete seeds.',
      primary: policy, completion: { completed, scheduled: jobs.length, censored, fraction: jobs.length ? completed / jobs.length : null },
      estimate, seedDeltas, strata, issues });
}
