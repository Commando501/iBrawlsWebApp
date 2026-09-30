import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuiteManifest } from './profiles';
import { createSuitePlan } from './plan';
import { appendLabResult, checkpointLabel, importLabRun, labRunReport, newLabRun, readableLabReport, retainedReports, reportBytes, UNKNOWN_CODE, type LabRuntimeIdentity } from './labReport';
import { trialCheck, type TrialResult } from './runner';
import { LiveTimings } from './telemetry';
const runtime: LabRuntimeIdentity = { kind: 'lab-browser', buildId: null, userAgent: 'test-browser', fixedHz: 60, model: 'v2-medium' };
async function fixture() {
  const manifest = createSuiteManifest('quick'); manifest.cases = manifest.cases.slice(0, 1);
  manifest.cases[0].seeds = [101]; manifest.cases[0].mirrored = false;
  const plan = await createSuitePlan(manifest, UNKNOWN_CODE);
  return newLabRun(plan, runtime);
}
function result(id: string, termination: TrialResult['termination'] = 'scenario-complete'): TrialResult {
  const frame = { tick: 60, phase: 'playing' as const, round: 1, clock: 521, scores: { blue: 0, red: 0 }, holder: null, ballState: 'loose', alive: ['bot'] };
  return { jobId: id, termination, check: trialCheck(id, termination, 'observed'), start: frame, end: frame,
    trace: Array.from({ length: 200 }, () => ({ ...frame })), droppedTraceEntries: 0, metrics: null, simulationCost: { samples: 60, meanMs: 1, maxMs: 2 } };
}
test('report export/import recomputes verdicts, labels references and cannot certify acceptance', async () => {
  let run = await fixture();
  for (const job of run.plan.jobs) run = appendLabResult(run, result(job.id));
  run.status = 'completed';
  const imported = await importLabRun(JSON.stringify({ ...run, report: { verdict: 'pass', milestone7Verdict: 'pass' } }));
  assert.equal(imported.source, 'imported'); assert.notEqual(imported.id, run.id);
  assert.equal(labRunReport(imported).verdict, 'inconclusive');
  assert.equal(labRunReport(imported).milestone7Verdict, 'inconclusive');
  assert.equal(labRunReport(imported).gates.find(g => g.id === 'human-review')!.verdict, 'not-run');
  assert.match(readableLabReport(imported), /unverified browser build/);
  assert.match(readableLabReport(imported), /Missing required evidence/);
});
test('changed frozen maps, forged trial results, duplicate jobs and unsupported imports are rejected', async () => {
  const run = appendLabResult(await fixture(), result((await fixture()).plan.jobs[0].id));
  const mutate = async (edit: (value: any) => void) => { const raw = structuredClone(run); edit(raw); await assert.rejects(importLabRun(JSON.stringify(raw))); };
  await mutate(r => r.plan.cases[0].map.arenaRadius++);
  await mutate(r => r.results[0].check.verdict = 'fail');
  await mutate(r => r.results.push(r.results[0]));
  await mutate(r => r.selectedJobIds = []);
  await mutate(r => r.runtime.fixedHz = 30);
  await mutate(r => r.results[0].end = {});
  await mutate(r => r.version = 2);
});

test('timing imports retain historical evidence and validate the playing-tick warmup contract', async () => {
  const run = await fixture(), trial = result(run.plan.jobs[0].id), timing = new LiveTimings();
  timing.playingTicks = 40; timing.record('plannerRefresh', 2);
  trial.timings = timing.finish();
  const populated = appendLabResult(run, trial);
  assert.deepEqual((await importLabRun(JSON.stringify(populated))).results[0].timings, trial.timings);
  for (const patch of [{ playingTicks: -1 }, { playingTicks: 61 }, { playingTicks: 1.5 },
    { playingTicks: undefined }, { warmupBasis: 'elapsed-ticks' }, { version: 3 }]) {
    const changed = structuredClone(populated);
    Object.assign(changed.results[0].timings!, patch);
    await assert.rejects(importLabRun(JSON.stringify(changed)), /Malformed timing evidence/);
  }
  const historical = structuredClone(populated);
  historical.results[0].timings = { version: 1, warmupTicks: 120, dropped: 0,
    cold: trial.timings.cold, warm: trial.timings.warm };
  assert.equal((await importLabRun(JSON.stringify(historical))).results[0].timings!.version, 1);
});
test('cancelled and interrupted checkpoints retain completed evidence without crediting unrun jobs', async () => {
  let run = await fixture(); run = appendLabResult(run, result(run.plan.jobs[0].id));
  assert.match(checkpointLabel(run), /Unfinished checkpoint/);
  assert.equal(checkpointLabel(run, true), 'running');
  const imported = await importLabRun(JSON.stringify(run));
  assert.equal(labRunReport(imported).jobs[0].verdict, 'pass');
  assert.equal(labRunReport(imported).jobs[1].verdict, 'not-run');
  run = appendLabResult(run, result(run.plan.jobs[1].id, 'cancelled')); run.status = 'cancelled';
  assert.equal(labRunReport(run).verdict, 'inconclusive');
  assert.equal(checkpointLabel(run), 'cancelled');
});
test('trace and storage retention are bounded while endpoints and failed outcomes survive', async () => {
  const plan = await createSuitePlan(createSuiteManifest('quick'), UNKNOWN_CODE);
  let run = newLabRun(plan, runtime);
  for (const job of plan.jobs) run = appendLabResult(run, result(job.id, 'invalid-state'));
  assert.equal(run.results.reduce((n, r) => n + r.trace.length, 0), 1024);
  assert.ok(run.results.every(r => r.trace.length <= 64 && r.trace.length + r.droppedTraceEntries === 200));
  assert.equal(labRunReport(run).verdict, 'fail'); assert.equal(run.results[0].end!.tick, 60);
  const rows = Array.from({ length: 15 }, (_, i) => ({ ...run, id: `old-${i}`, createdAt: i }));
  const kept = retainedReports(rows, run);
  assert.ok(kept.length <= 12); assert.equal(kept[0].id, run.id); assert.ok(!kept.some(r => r.id === 'old-0'));
  assert.throws(() => retainedReports([], { ...run, error: 'x'.repeat(8 * 1024 * 1024) }), /8 MiB/);
  const standard = newLabRun(await createSuitePlan(createSuiteManifest('standard'), UNKNOWN_CODE), runtime);
  assert.ok(reportBytes(standard) < 8 * 1024 * 1024, 'default standard plan must fit storage');
});
test('reruns have new identities and do not erase or reuse prior failure evidence', async () => {
  const original = await fixture(); const failed = appendLabResult(original, result(original.plan.jobs[0].id, 'invalid-state'));
  const rerun = newLabRun(original.plan, runtime, [original.plan.jobs[0].id], original.id);
  assert.notEqual(rerun.id, original.id); assert.equal(rerun.parentId, original.id); assert.equal(rerun.results.length, 0);
  assert.equal(labRunReport(failed).verdict, 'fail'); assert.equal(labRunReport(rerun).verdict, 'not-run');
});
