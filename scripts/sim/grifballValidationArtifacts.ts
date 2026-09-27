import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalJSON } from '../../src/game/grifballValidation/plan';
import { aggregateSuiteReport } from '../../src/game/grifballValidation/report';
import type { TrialResult } from '../../src/game/grifballValidation/runner';
import type { CheckResult, SuitePlan } from '../../src/game/grifballValidation/types';

export const digest = (value: unknown) => createHash('sha256').update(canonicalJSON(value)).digest('hex');
export const jobFile = (id: string) => `${digest(id)}.json`;
export function readJSON<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')); }
/** Flush the complete temporary file before publishing it. A killed write cannot replace valid evidence with partial JSON. */
function atomicText(path: string, value: string) {
  const temporary = `${path}.tmp`;
  const fd = openSync(temporary, 'w');
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
}
export function atomicJSON(path: string, value: unknown) { atomicText(path, JSON.stringify(value, null, 2) + '\n'); }
export interface RunIdentity {
  schemaVersion: 1;
  code: SuitePlan['code'];
  node: string; platform: string; arch: string;
  playwright: string; browser: string; executableHash: string;
  launch: { channel: 'chromium'; headless: true; args: string[] };
  lockHash: string; productionHash: string; validationHash: string; buildId: string;
}
export interface JobArtifact {
  schemaVersion: 1; planId: string; identityHash: string;
  job: SuitePlan['jobs'][number]; fixture: SuitePlan['cases'][number];
  result: TrialResult; resultHash: string; copiedFrom: string | null;
}
export interface PreviousRun { directory: string; summary: unknown; failures: TrialResult[]; failedChecks: CheckResult[]; interruptedJob: string | null }
export class RunArtifacts {
  readonly results: TrialResult[] = [];
  readonly gates: CheckResult[] = [];
  identity: RunIdentity | null = null;
  previous: PreviousRun | null = null;
  activeJob: string | null = null;
  setupError: string | null = null;
  readonly startedAt = new Date().toISOString();
  constructor(readonly directory: string, readonly plan: SuitePlan, readonly selectedCase: string | null) {
    if (existsSync(directory)) throw new Error(`Output directory already exists: ${directory}`);
    mkdirSync(resolve(directory, '..'), { recursive: true });
    mkdirSync(directory); // exclusive ownership, including a race with another runner
    for (const sub of ['jobs', 'logs', 'screenshots']) mkdirSync(join(directory, sub));
    atomicJSON(join(directory, 'environment.json'), { node: process.version, platform: process.platform, arch: process.arch });
    atomicJSON(join(directory, 'manifest.json'), plan.manifest);
    atomicJSON(join(directory, 'plan.json'), plan);
    this.checkpoint('preparing');
  }
  setIdentity(identity: RunIdentity) {
    this.identity = identity; atomicJSON(join(this.directory, 'identity.json'), identity);
  }
  save(result: TrialResult, copiedFrom: string | null = null) {
    if (!this.identity) throw new Error('Cannot persist a trial without runtime/build identity');
    if (this.results.some(r => r.jobId === result.jobId)) throw new Error('Duplicate job result');
    const job = this.plan.jobs.find(j => j.id === result.jobId);
    const fixture = this.plan.cases.find(c => c.specification.id === job?.caseId);
    if (!job || !fixture || result.check.id !== result.jobId) throw new Error('Result is outside frozen plan');
    aggregateSuiteReport(this.plan, { planId: this.plan.id, jobs: [result.check], gates: [] });
    const path = join(this.directory, 'jobs', jobFile(job.id));
    if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);
    const artifact: JobArtifact = { schemaVersion: 1, planId: this.plan.id, identityHash: digest(this.identity),
      job, fixture, result, resultHash: digest(result), copiedFrom };
    atomicJSON(path, artifact);
    this.results.push(result); this.activeJob = null; this.checkpoint('running');
  }
  resume(previousDirectory: string) {
    if (!this.identity) throw new Error('Runtime identity not ready');
    const previous = resolve(previousDirectory);
    const plan = readJSON<SuitePlan>(join(previous, 'plan.json'));
    const identity = readJSON<RunIdentity>(join(previous, 'identity.json'));
    if (canonicalJSON(plan) !== canonicalJSON(this.plan) || canonicalJSON(identity) !== canonicalJSON(this.identity))
      throw new Error('Resume rejected: manifest, frozen inputs, code, assets or runtime differ');
    const summary = readJSON<{ planId: string; activeJob?: string | null; report?: { gates?: CheckResult[] } }>(join(previous, 'summary.json'));
    if (summary.planId !== this.plan.id) throw new Error('Resume rejected: summary belongs to another plan');
    const prior = existsSync(join(previous, 'history.json')) ? readJSON<PreviousRun>(join(previous, 'history.json')) : null;
    const files = readdirSync(join(previous, 'jobs')).filter(f => f.endsWith('.json')).sort();
    const records = files.map(file => {
      const record = readJSON<JobArtifact>(join(previous, 'jobs', file));
      const job = this.plan.jobs.find(j => j.id === record.result?.jobId);
      if (!job || record.schemaVersion !== 1 || record.planId !== this.plan.id || record.identityHash !== digest(this.identity) ||
          record.resultHash !== digest(record.result) || file !== jobFile(job.id) || canonicalJSON(record.job) !== canonicalJSON(job) ||
          canonicalJSON(record.fixture) !== canonicalJSON(this.plan.cases.find(c => c.specification.id === job.caseId)))
        throw new Error(`Resume rejected: corrupt or incompatible job artifact ${file}`);
      aggregateSuiteReport(this.plan, { planId: this.plan.id, jobs: [record.result.check], gates: [] });
      if (record.result.check.id !== job.id) throw new Error('Resume rejected: result identity mismatch');
      return record;
    });
    this.previous = { directory: previous, summary, interruptedJob: summary.activeJob ?? null,
      failedChecks: [...(prior?.failedChecks ?? []), ...(summary.report?.gates ?? []).filter(g => g.verdict === 'fail')],
      failures: [...(prior?.failures ?? []), ...records.filter(r => r.result.check.verdict === 'fail').map(r => r.result)] };
    atomicJSON(join(this.directory, 'history.json'), this.previous);
    // Failed/cancelled jobs restart from their beginning. Completed results remain immutable, including capped matches.
    if (!this.selectedCase) for (const record of records) if (record.result.check.state === 'completed')
      this.save(record.result, previous);
    this.checkpoint('running');
  }
  private status = 'preparing';
  checkpoint(status: string) {
    this.status = status;
    const report = aggregateSuiteReport(this.plan, { planId: this.plan.id, jobs: this.results.map(r => r.check), gates: this.gates });
    const summary = { schemaVersion: 1, status, startedAt: this.startedAt, updatedAt: new Date().toISOString(),
      planId: this.plan.id, selectedCase: this.selectedCase, activeJob: this.activeJob,
      identityHash: this.identity ? digest(this.identity) : null, setupError: this.setupError,
      outcome: this.setupError ? 'error' : (this.previous?.failures.length || this.previous?.failedChecks.length) ? 'fail' : report.verdict,
      previousRun: this.previous?.directory ?? null, previousFailures: (this.previous?.failures.length ?? 0) + (this.previous?.failedChecks.length ?? 0),
      results: this.results, report };
    atomicJSON(join(this.directory, 'summary.json'), summary);
    const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    const rows = [...report.jobs, ...report.gates].map(r => `<tr><td>${this.results.some(result => result.jobId === r.id) ? `<a href="jobs/${jobFile(r.id)}">${escape(r.id)}</a>` : escape(r.id)}</td><td>${escape(r.state)}</td><td>${escape(r.verdict)}</td><td>${escape(r.summary)}</td></tr>`).join('');
    atomicText(join(this.directory, 'report.html'), `<!doctype html><meta charset="utf-8"><title>Grifball validation</title><style>body{font:15px system-ui;margin:32px;background:#101827;color:#e2e8f0}td,th{text-align:left;padding:10px;border-bottom:1px solid #475569;overflow-wrap:anywhere}table{width:100%;table-layout:fixed}a{color:#7dd3fc}</style><h1>Grifball validation</h1><p>${escape(status)} · profile ${escape(report.profile)} · ${escape(summary.outcome)}</p><p>Automated: ${escape(report.automatedVerdict)} · Repository: ${escape(report.repositoryVerdict)} · Milestone 7: ${escape(report.milestone7Verdict)}</p><p>Previous failed attempts: ${summary.previousFailures}. ${escape(this.setupError ?? '')}</p><p>Plan ${escape(this.plan.id)}. Case selection: ${escape(this.selectedCase ?? 'all')}.</p><p><a href="summary.json">Summary JSON</a> · <a href="plan.json">Frozen inputs</a> · <a href="identity.json">Build/runtime identity</a> · <a href="manifest.json">Manifest</a></p><p>Trial end and trace contain valid frames only. When available, failureState in job JSON records the failing tick, validation stage, ownership and actor state separately.</p><table><tr><th>Job or gate</th><th>Execution</th><th>Verdict</th><th>Evidence summary</th></tr>${rows}</table>`);
    return summary;
  }
  exitCode(): number {
    const summary = this.checkpoint(this.status);
    if (this.setupError) return 3;
    if (summary.previousFailures || summary.report.automatedVerdict === 'fail') return 1;
    if (summary.report.automatedVerdict !== 'pass') return 2;
    return 0;
  }
}
