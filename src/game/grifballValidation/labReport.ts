import { canonicalJSON, createSuitePlan } from './plan';
import { aggregateSuiteReport } from './report';
import { trialCheck, type TrialResult } from './runner';
import type { CheckResult, SuitePlan } from './types';

export const REPORT_LIMIT = 12;
export const REPORT_BYTES = 8 * 1024 * 1024;
export const HISTORY_BYTES = 32 * 1024 * 1024;
export const BROWSER_JOB_LIMIT = 512;
export const UNKNOWN_CODE = { commit: null, dirty: null, workingTreeHash: null, scope: [] };
export interface LabRuntimeIdentity {
  kind: 'lab-browser'; buildId: string | null; userAgent: string; fixedHz: 60; model: 'v2-medium';
}
export interface LabRun {
  format: 'grifball-lab-run'; version: 1; id: string; createdAt: number;
  source: 'local' | 'imported'; parentId: string | null;
  status: 'running' | 'paused' | 'completed' | 'cancelled' | 'error';
  plan: SuitePlan; runtime: LabRuntimeIdentity; selectedJobIds: string[];
  currentJobId: string | null; results: TrialResult[]; error: string | null;
}
export function newLabRun(plan: SuitePlan, runtime: LabRuntimeIdentity, selectedJobIds = plan.jobs.map(j => j.id), parentId: string | null = null): LabRun {
  if (plan.jobs.length > BROWSER_JOB_LIMIT) throw new Error(`The Lab supports at most ${BROWSER_JOB_LIMIT} jobs per report. Use the CLI for larger matrices.`);
  if (!selectedJobIds.length || new Set(selectedJobIds).size !== selectedJobIds.length || selectedJobIds.some(id => !plan.jobs.some(j => j.id === id))) throw new Error('Invalid job selection');
  return { format: 'grifball-lab-run', version: 1, id: crypto.randomUUID(), createdAt: Date.now(), source: 'local', parentId,
    status: 'running', plan, runtime, selectedJobIds: [...selectedJobIds], currentJobId: null, results: [], error: null };
}
/** Keep endpoints/metrics and a recent, bounded trace. Full CLI artifacts remain on disk. */
export function appendLabResult(run: LabRun, result: TrialResult): LabRun {
  let budget = 1024;
  const results = [...run.results.filter(r => r.jobId !== result.jobId), result].reverse().map(r => {
    const count = Math.min(64, budget, r.trace.length); budget -= count;
    return { ...r, trace: count ? r.trace.slice(-count) : [], droppedTraceEntries: r.droppedTraceEntries + r.trace.length - count };
  }).reverse();
  return { ...run, results, currentJobId: null };
}
export function labRunReport(run: LabRun) {
  // Browser trials and imported references cannot certify repository, VS5 or human gates.
  return aggregateSuiteReport(run.plan, { planId: run.plan.id, jobs: run.results.map(r => r.check), gates: [] });
}
export function checkpointLabel(run: LabRun, active = false): string {
  return !active && (run.status === 'running' || run.status === 'paused')
    ? 'Unfinished checkpoint — reload or another tab; remaining jobs have no evidence.' : run.status;
}
export function reportBytes(run: LabRun): number { return new TextEncoder().encode(JSON.stringify(run)).byteLength; }
export function retainedReports(runs: LabRun[], incoming: LabRun): LabRun[] {
  const size = reportBytes(incoming);
  if (size > REPORT_BYTES) throw new Error('Report exceeds the 8 MiB browser limit. Export JSON and use the CLI for larger runs.');
  const result = [incoming]; let total = size;
  for (const run of runs.filter(r => r.id !== incoming.id).sort((a, b) => b.createdAt - a.createdAt)) {
    const bytes = reportBytes(run);
    if (result.length < REPORT_LIMIT && total + bytes <= HISTORY_BYTES) { result.push(run); total += bytes; }
  }
  return result;
}
function assertFrame(frame: TrialResult['end']) {
  if (frame === null) return;
  if (!frame || !Number.isInteger(frame.tick) || frame.tick < 0 || !Number.isFinite(frame.clock) ||
      !Number.isInteger(frame.round) || !frame.scores || !['blue', 'red'].every(t => Number.isFinite(frame.scores[t as 'blue' | 'red'])) ||
      !['countdown', 'playing', 'scored', 'matchEnd'].includes(frame.phase) ||
      typeof frame.ballState !== 'string' || !(frame.holder === null || typeof frame.holder === 'string') ||
      !Array.isArray(frame.alive) || frame.alive.length > 32 || frame.alive.some(id => typeof id !== 'string')) throw new Error('Malformed trial frame');
}
/** Imports are references, never merged into a local run or counted as current acceptance evidence. */
export async function importLabRun(text: string): Promise<LabRun> {
  if (new TextEncoder().encode(text).byteLength > REPORT_BYTES) throw new Error('Import is limited to 8 MiB.');
  const raw = JSON.parse(text) as LabRun;
  if (!raw || raw.format !== 'grifball-lab-run' || raw.version !== 1 || !raw.plan) throw new Error('Expected a version 1 Lab report JSON. CLI artifacts remain in their run directory.');
  const plan = await createSuitePlan(raw.plan.manifest, raw.plan.code);
  if (canonicalJSON(plan) !== canonicalJSON(raw.plan)) throw new Error('Incompatible or modified frozen inputs. This report cannot be used with the current maps/runtime.');
  if (!raw.runtime || raw.runtime.kind !== 'lab-browser' || raw.runtime.fixedHz !== 60 || raw.runtime.model !== 'v2-medium' ||
      !(raw.runtime.buildId === null || typeof raw.runtime.buildId === 'string') || typeof raw.runtime.userAgent !== 'string' || raw.runtime.userAgent.length > 1000) throw new Error('Unsupported runtime identity');
  if (!Array.isArray(raw.selectedJobIds)) throw new Error('Missing job selection');
  const run = newLabRun(plan, raw.runtime, raw.selectedJobIds);
  if (!['running', 'paused', 'completed', 'cancelled', 'error'].includes(raw.status) || !Number.isFinite(raw.createdAt) ||
      !(raw.error === null || typeof raw.error === 'string') || !Array.isArray(raw.results) || raw.results.length > plan.jobs.length ||
      new Set(raw.results.map(r => r.jobId)).size !== raw.results.length) throw new Error('Malformed report state');
  let normalized = { ...run, source: 'imported' as const, status: raw.status, createdAt: raw.createdAt, parentId: null, error: raw.error?.slice(0, 1000) ?? null };
  for (const r of raw.results) {
    if (!r || !run.selectedJobIds.includes(r.jobId) || !['match-end', 'scenario-complete', 'simulation-cap', 'watchdog', 'cancelled', 'invalid-state', 'setup-error'].includes(r.termination) ||
        !Array.isArray(r.trace) || r.trace.length > 1024 || !Number.isInteger(r.droppedTraceEntries) || r.droppedTraceEntries < 0 || !r.check || typeof r.check.summary !== 'string') throw new Error('Malformed trial result');
    assertFrame(r.start); assertFrame(r.end); r.trace.forEach(assertFrame);
    const check = trialCheck(r.jobId, r.termination, r.check.summary);
    if (canonicalJSON(check) !== canonicalJSON(r.check)) throw new Error('Trial verdict does not match its termination');
    // Keep JSON diagnostics inert. Shape and finite numbers are checked before they can reach rendering.
    canonicalJSON(r);
    normalized = { ...appendLabResult(normalized, structuredClone(r)), source: 'imported' };
  }
  labRunReport(normalized);
  return normalized;
}
export function readableLabReport(run: LabRun): string {
  const report = labRunReport(run);
  const checks = (values: CheckResult[]) => values.map(c => `${c.id}\n  ${c.state} / ${c.verdict}: ${c.summary}`).join('\n');
  return `Grifball validation — ${run.plan.manifest.profile}\n${new Date(run.createdAt).toISOString()}\n${checkpointLabel(run)}\nSource: ${run.source}\nBuild: ${run.runtime.buildId ?? 'unverified browser build'}\nRuntime: ${run.runtime.userAgent}\nPlan: ${run.plan.id}\nOverall: ${report.verdict}\nM7 acceptance: ${report.milestone7Verdict}\n${run.error ?? ''}\n\nTrials\n${checks(report.jobs)}\n\nGates (browser execution does not certify these)\n${checks(report.gates)}\n\nMissing required evidence\n${report.missingRequired.join('\n')}\n`;
}
