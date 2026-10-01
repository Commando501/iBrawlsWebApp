import { EVALUATION_METRICS, evaluationMetricInputs, estimateSeedDeltas, type EvaluationMetric } from '../grifballEvaluation';
import { gate, indexResults, nullControlRequired, type GateEvaluation, type GateProtocol } from './gates';
import type { TrialResult } from './runner';
import type { CheckResult, SuitePlan, ValidationJob } from './types';
export function qualityGate(plan: SuitePlan, results: readonly TrialResult[], nullCheck: CheckResult, protocol?: GateProtocol): GateEvaluation {
  const policy = plan.manifest.quality;
  if (!policy) return gate('quality', 'not-run', 'No frozen quality hypothesis or evidence minimum.', null);
  const indexed = indexResults(plan, results), cases = plan.cases.filter(c => c.specification.mode === 'match');
  const jobs = plan.jobs.filter(j => cases.some(c => c.specification.id === j.caseId));
  const completed = jobs.filter(j => indexed.get(j.id)?.termination === 'match-end' && indexed.get(j.id)?.check.verdict === 'pass').length;
  const censored = jobs.filter(j => indexed.get(j.id)?.termination === 'simulation-cap').length;
  const issues: string[] = [];
  if (nullCheck.verdict !== 'pass') issues.push('Identical-config control did not pass on a pinned runtime.');
  if (!protocol?.quality) issues.push('Missing predeclared tuning seed/map ledger.');
  if (!cases.length || cases.some(c => !c.specification.mirrored || c.specification.opponents.length !== 3)) issues.push('Full mirrored, three-style match matrix required.');
  if (new Set(cases.map(c => c.specification.mapId)).size < 2) issues.push('Quality generalization requires at least two distinct maps.');
  if (completed !== jobs.length || !jobs.length) issues.push('Missing, failed or capped matches prevent a complete-match improvement claim.');
  const ledger = protocol?.quality;
  if (ledger && cases.some(c => ledger.tuningMapIds.includes(c.specification.mapId) || c.specification.seeds.some(s => ledger.tuningSeeds.includes(s)))) issues.push('Held-out inputs overlap tuning inputs.');
  const metricKeys = Object.keys(EVALUATION_METRICS) as EvaluationMetric[];
  const metric = (job: ValidationJob, key: EvaluationMetric) => {
    const r = indexed.get(job.id);
    if (!r) return { value: null, reason: 'missing-trial' };
    if (r.check.verdict === 'fail') return { value: null, reason: 'failed-trial' };
    if (r.termination !== 'match-end' || r.check.verdict !== 'pass') return { value: null, reason: 'incomplete-trial' };
    if (!r.metrics) return { value: null, reason: 'missing-metrics' };
    const terms = evaluationMetricInputs({ job, metrics: r.metrics }, key);
    const { numerator, denominator } = terms;
    if (!Number.isFinite(numerator) || denominator !== null && (!Number.isFinite(denominator) || denominator < 0))
      return { value: null, reason: 'invalid-metric', ...terms };
    if (denominator === 0) return { value: null, reason: 'no-opportunity', ...terms };
    const value = denominator === null ? numerator : numerator / denominator;
    return Number.isFinite(value) ? { value, reason: null, ...terms } : { value: null, reason: 'invalid-metric', ...terms };
  };
  const strata = cases.flatMap(c => c.specification.opponents.map(opponent => {
    const base = jobs.filter(j => j.caseId === c.specification.id && j.opponent === opponent && j.variant === 'baseline');
    const measures = Object.fromEntries(metricKeys.map(key => {
      const bySeed = new Map<number, number[]>();
      const observations = new Map(jobs.filter(j => j.caseId === c.specification.id && j.opponent === opponent).map(j => [j.id, metric(j, key)]));
      const unavailable = jobs.filter(j => observations.get(j.id)?.reason).map(j => {
        const { value: _value, ...observation } = observations.get(j.id)!;
        return { jobId: j.id, seed: j.seed, mirrored: j.mirrored, variant: j.variant, ...observation };
      });
      for (const a of base) {
        const b = jobs.find(j => j.caseId === a.caseId && j.seed === a.seed && j.opponent === a.opponent && j.mirrored === a.mirrored && j.variant === 'candidate')!;
        const x = observations.get(a.id)!.value, y = b ? observations.get(b.id)!.value : null;
        if (x === null || y === null) continue;
        const values = bySeed.get(a.seed) ?? []; values.push(y - x); bySeed.set(a.seed, values);
      }
      const seedDeltas = [...bySeed].filter(([, v]) => v.length === 2).map(([seed, v]) => ({ seed, delta: (v[0] + v[1]) / 2 }));
      return [key, { estimate: estimateSeedDeltas(seedDeltas.map(v => v.delta), seedDeltas.length * 2), seedDeltas, unavailable }];
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
  const insufficient = strata.flatMap(s => metricKeys.filter(key => s.measures[key].estimate.seeds < policy.minIndependentSeeds)
    .map(key => `${s.caseId}/${s.map}/${s.opponent}/${key} (${s.measures[key].estimate.seeds}/${policy.minIndependentSeeds} seed clusters)`));
  if (insufficient.length) issues.push(`Metrics lack required complete pairs: ${insufficient.join(', ')}. See each measure's unavailable jobs and reasons.`);
  const improved = estimate.low !== null && estimate.low > policy.minEffect;
  const regression = estimate.high !== null && estimate.high < -policy.minEffect;
  // A pooled win cannot establish transfer to a map/style that is flat, uncertain
  // or worse. Require positive lower bounds in every predeclared stratum, using
  // the same independent seed clusters; the pooled practical-effect hurdle remains.
  const regressions = strata.filter(s => s.measures.goalMargin.estimate.high !== null && s.measures.goalMargin.estimate.high! < -policy.minEffect);
  const unresolved = strata.filter(s => s.measures.goalMargin.estimate.low === null || s.measures.goalMargin.estimate.low! <= 0);
  const labels = (groups: typeof strata) => groups.map(s => `${s.caseId}/${s.map}/${s.opponent}`).join(', ');
  const generalized = unresolved.length === 0 && strata.length > 0;
  return gate('quality', issues.length ? 'inconclusive' : regression || regressions.length ? 'fail'
    : improved && generalized && nullControlRequired(plan) ? 'pass' : 'inconclusive',
    issues.length ? issues.join(' ') : regressions.length ? `Goal-margin regression detected in ${labels(regressions)}.`
    : regression ? 'Pooled goal-margin regression detected.'
    : !generalized ? `Positive goal-margin effect not established in ${labels(unresolved)}.`
    : improved && nullControlRequired(plan) ? 'Primary effect exceeds the predeclared minimum with positive effects across every map/opponent stratum.'
    : 'No established improvement over the minimum effect.',
    { protocol: 'paired-seed-t95-v2', weighting: 'Equal case × opponent weights, both sides averaged within seed; all cases must share complete seeds.',
      generalization: { minimumMaps: 2, stratumLowerBound: 0, regressions: regressions.map(s => ({ caseId: s.caseId, map: s.map, opponent: s.opponent })),
        unresolved: unresolved.map(s => ({ caseId: s.caseId, map: s.map, opponent: s.opponent })) },
      primary: policy, completion: { completed, scheduled: jobs.length, censored, fraction: jobs.length ? completed / jobs.length : null },
      estimate, seedDeltas, strata, issues, coverageVersion: 1 });
}
