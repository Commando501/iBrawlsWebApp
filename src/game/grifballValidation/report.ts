import { choice, nonempty, object } from './manifest';
import { freeze } from './plan';
import { EXECUTION_STATES, GATES, VERDICTS, type CheckResult, type SuiteEvidence, type SuitePlan, type SuiteReport, type Verdict } from './types';

function normalizeResults(value: unknown, expected: readonly string[], at: string): Map<string, CheckResult> {
  if (!Array.isArray(value)) throw new Error(`${at}: expected result array`);
  const results = new Map<string, CheckResult>();
  for (const raw of value) {
    const r = object(raw, ['id', 'state', 'verdict', 'summary', 'evidence'], at);
    const id = nonempty(r.id, `${at}.id`);
    if (!expected.includes(id) || results.has(id)) throw new Error(`${at}: unknown or duplicate result ${id}`);
    const state = choice(r.state, EXECUTION_STATES, `${id}.state`), verdict = choice(r.verdict, VERDICTS, `${id}.verdict`);
    if (state === 'completed' && verdict === 'not-run' || state === 'error' && verdict !== 'fail' ||
      (state === 'queued' || state === 'running') && verdict !== 'not-run' ||
      state === 'cancelled' && !['not-run', 'inconclusive', 'fail'].includes(verdict))
      throw new Error(`${id}: incompatible execution state and verdict`);
    if (!Array.isArray(r.evidence)) throw new Error(`${id}: expected evidence references`);
    const evidence = Array.from(r.evidence, e => nonempty(e, `${id}.evidence`));
    if (verdict === 'pass' && !evidence.length) throw new Error(`${id}: a pass requires evidence references`);
    results.set(id, { id, state, verdict, summary: nonempty(r.summary, `${id}.summary`), evidence });
  }
  return results;
}
export function aggregateVerdict(results: readonly CheckResult[]): Verdict {
  if (results.some(r => r.verdict === 'fail')) return 'fail';
  if (results.length && results.every(r => r.state === 'completed' && r.verdict === 'pass')) return 'pass';
  if (!results.length || results.every(r => r.state === 'queued' && r.verdict === 'not-run')) return 'not-run';
  return 'inconclusive';
}
export function aggregateSuiteReport(plan: SuitePlan, evidence: SuiteEvidence): SuiteReport {
  const e = object(evidence, ['planId', 'jobs', 'gates'], 'evidence');
  if (e.planId !== plan.id) throw new Error('Evidence belongs to a different frozen plan');
  const jobResults = normalizeResults(e.jobs, plan.jobs.map(j => j.id), 'jobs');
  const gateResults = normalizeResults(e.gates, GATES, 'gates');
  const missing = (id: string): CheckResult => ({ id, state: 'queued', verdict: 'not-run', summary: 'No executor evidence supplied.', evidence: [] });
  const jobs = plan.jobs.map(j => jobResults.get(j.id) ?? missing(j.id));
  // Keep gates outside this profile visible without confusing scoped success with M7 acceptance.
  const gates = GATES.map(g => gateResults.get(g) ?? missing(g));
  const required = [...jobs, ...gates.filter(g => plan.manifest.requiredGates.includes(g.id as typeof GATES[number]))];
  const milestone7 = aggregateVerdict([...jobs, ...gates]);
  return freeze({ schemaVersion: 1, planId: plan.id, profile: plan.manifest.profile, jobs, gates,
    verdict: aggregateVerdict(required),
    automatedVerdict: aggregateVerdict(required.filter(r => r.id !== 'human-review')),
    repositoryVerdict: aggregateVerdict(gates.filter(g => ['repository-tests', 'typecheck', 'build'].includes(g.id))),
    milestone7Verdict: milestone7 === 'pass' && plan.manifest.profile !== 'acceptance' ? 'inconclusive' : milestone7,
    missingRequired: required.filter(r => r.state !== 'completed' || r.verdict === 'not-run' || r.verdict === 'inconclusive').map(r => r.id),
  });
}
