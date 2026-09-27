import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuiteManifest } from './profiles';
import { createSuitePlan } from './plan';
import { runValidationSuite, trialCheck, type TrialHandle, type TrialResult } from './runner';
import { aggregateSuiteReport } from './report';

async function plan() {
  const manifest = createSuiteManifest('quick');
  manifest.cases = [manifest.cases[0]];
  Object.assign(manifest.cases[0], { seeds: [101], mirrored: false });
  return createSuitePlan(manifest, { commit: null, dirty: null, workingTreeHash: null, scope: [] });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function handle(id: string) {
  const done = deferred<TrialResult>(); let result: TrialResult | null = null; let disposed = false;
  const h: TrialHandle = { done: done.promise, dispose: () => { disposed = true; },
    stop: (reason, message = reason) => {
      result ??= { jobId: id, termination: reason, check: trialCheck(id, reason, message), start: null, end: null,
        trace: [], droppedTraceEntries: 0, metrics: null, simulationCost: { samples: 0, meanMs: 0, maxMs: 0 } };
      done.resolve(result); return result;
    } };
  return { h, disposed: () => disposed };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('queue waits for readiness and completion, disposes between jobs, and retains every result', async () => {
  const p = await plan(), loaded: string[] = [], events: string[] = [];
  const ready = deferred<TrialHandle>(), first = handle(p.jobs[0].id);
  const run = runValidationSuite(p, { load: async (fixture, job) => {
    assert.equal(fixture.inputHash, job.inputHash); loaded.push(job.id); events.push('load');
    if (loaded.length === 1) return ready.promise;
    assert.ok(first.disposed()); const next = handle(job.id); next.h.stop('scenario-complete'); return next.h;
  }, unload: () => { events.push('unload'); } });
  await flush(); assert.equal(loaded.length, 1);
  ready.resolve(first.h); await flush(); assert.equal(loaded.length, 1);
  first.h.stop('scenario-complete'); const output = await run;
  assert.equal(output.results.length, 2); assert.deepEqual(events, ['load', 'unload', 'load', 'unload']);
  assert.equal(output.report.verdict, 'inconclusive'); assert.equal(output.report.repositoryVerdict, 'not-run');
  assert.ok(Object.isFrozen(output.results[0]));
});

test('cancellation during loading returns promptly, leaves later jobs not-run and cleans up a late handle', async () => {
  const p = await plan(), ready = deferred<TrialHandle>(), abort = new AbortController(); let unloaded = 0;
  const run = runValidationSuite(p, { load: () => ready.promise, unload: () => { unloaded++; } }, { signal: abort.signal });
  abort.abort(); const output = await run;
  assert.equal(output.results[0].termination, 'cancelled'); assert.equal(output.results[0].start, null);
  assert.equal(output.report.jobs[1].verdict, 'not-run'); assert.equal(unloaded, 1);
  const late = handle(p.jobs[0].id); ready.resolve(late.h); await flush(); assert.ok(late.disposed());
});

test('cancellation while running stops once and restores the host', async () => {
  const p = await plan(), first = handle(p.jobs[0].id), abort = new AbortController(); let loads = 0;
  const run = runValidationSuite(p, { load: async () => { loads++; return first.h; }, unload: () => {} }, { signal: abort.signal });
  await flush(); abort.abort(); const output = await run;
  assert.equal(output.results[0].termination, 'cancelled'); assert.equal(loads, 1); assert.ok(first.disposed());
});

test('real wall watchdog terminates a load that never resolves without simulation progress', async t => {
  const p = await plan(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const abort = new AbortController(); let loadSignal!: AbortSignal;
  const run = runValidationSuite(p, { load: async (_fixture, _job, signal) => { loadSignal = signal; return new Promise(() => {}); }, unload: () => {} },
    { signal: abort.signal, onProgress: progress => { if (progress.completed === 1) abort.abort(); } });
  t.mock.timers.tick(p.jobs[0].watchdogSeconds * 1000); await flush();
  const output = await run;
  assert.equal(output.results[0].termination, 'watchdog'); assert.equal(output.results[0].check.verdict, 'fail');
  assert.ok(loadSignal.aborted); t.mock.timers.reset();
});

test('load errors remain explicit and do not prevent cleanup or subsequent jobs', async () => {
  const p = await plan(); let unloads = 0;
  const output = await runValidationSuite(p, { load: async () => { throw new Error('arena missing'); }, unload: () => { unloads++; } });
  assert.equal(unloads, 2); assert.ok(output.results.every(r => r.termination === 'setup-error'));
  assert.match(output.results[0].check.summary, /arena missing/); assert.equal(output.report.verdict, 'fail');
});

test('caps are unfinished, errors fail, and an unidentified development build cannot receive a suite pass', async () => {
  const p = await plan(); assert.equal(trialCheck('x', 'simulation-cap', 'cap').verdict, 'inconclusive');
  assert.equal(trialCheck('x', 'invalid-state', 'bad').verdict, 'fail');
  const pass = (id: string) => trialCheck(id, 'scenario-complete', 'fixture evidence');
  const report = aggregateSuiteReport(p, { planId: p.id, jobs: p.jobs.map(j => pass(j.id)), gates: p.manifest.requiredGates.map(pass) });
  assert.equal(report.verdict, 'inconclusive'); assert.equal(report.automatedVerdict, 'inconclusive');
});


test('cleanup failure still unloads, retains evidence and stops before another arena can start', async () => {
  const p = await plan(); let loads = 0, unloads = 0;
  const output = await runValidationSuite(p, { load: async (_fixture, job) => {
    loads++; const first = handle(job.id); first.h.stop('scenario-complete');
    first.h.dispose = () => { throw new Error('restore failed'); }; return first.h;
  }, unload: () => { unloads++; } });
  assert.equal(loads, 1); assert.equal(unloads, 1); assert.equal(output.results[0].check.verdict, 'fail');
  assert.match(output.results[0].check.summary, /Cleanup failed.*restore failed/);
  assert.equal(output.report.jobs[1].verdict, 'not-run'); assert.deepEqual(output.plan, p);
});


test('selected execution preserves the full frozen plan and missing-job verdicts', async () => {
  const p = await plan();
  const host = { load: async (_fixture: unknown, job: { id: string }) => { const h = handle(job.id); h.h.stop('scenario-complete'); return h.h; }, unload: () => {} };
  const output = await runValidationSuite(p, host, { jobIds: [p.jobs[1].id] });
  assert.deepEqual(output.plan, p); assert.equal(output.results.length, 1);
  assert.equal(output.results[0].jobId, p.jobs[1].id);
  assert.equal(output.report.jobs[0].verdict, 'not-run'); assert.equal(output.report.jobs[1].verdict, 'pass');
  await assert.rejects(runValidationSuite(p, host, { jobIds: ['missing'] }), /Unknown/);
  await assert.rejects(runValidationSuite(p, host, { jobIds: [p.jobs[0].id, p.jobs[0].id] }), /duplicate/);
});

// Checkpoints and pauses belong outside the live trial and its wall watchdog.
import { JobBoundary } from './jobBoundary';
test('pause completes the current job, checkpoints after disposal, and resumes before loading the next', async t => {
  const p = await plan(), gate = new JobBoundary(), abort = new AbortController();
  const first = handle(p.jobs[0].id); let loads = 0, checkpoints = 0, waiting = false;
  const run = runValidationSuite(p, { load: async (_f, job) => {
    loads++; if (loads === 1) return first.h;
    const h = handle(job.id); h.h.stop('scenario-complete'); return h.h;
  }, unload: () => {} }, { signal: abort.signal, beforeJob: async () => { waiting = gate.paused; await gate.wait(abort.signal); },
    onResult: async () => { assert.ok(first.disposed()); checkpoints++; } });
  await flush(); gate.pause(); assert.equal(checkpoints, 0); first.h.stop('scenario-complete'); await flush();
  assert.equal(loads, 1); assert.equal(checkpoints, 1); assert.ok(waiting);
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.timers.tick(9999999); await flush(); assert.equal(loads, 1); t.mock.timers.reset();
  gate.resume(); const output = await run; assert.equal(loads, 2); assert.equal(output.results.length, 2);
});
test('cancel while paused starts no new trial; checkpoint failure stops the queue', async () => {
  const p = await plan(), gate = new JobBoundary(), abort = new AbortController(); gate.pause(); let loads = 0;
  const host = { load: async (_f: unknown, job: typeof p.jobs[number]) => { loads++; const h = handle(job.id); h.h.stop('scenario-complete'); return h.h; }, unload: () => {} };
  const run = runValidationSuite(p, host, { signal: abort.signal, beforeJob: () => gate.wait(abort.signal) });
  await flush(); abort.abort(); assert.equal((await run).results.length, 0); assert.equal(loads, 0);
  await assert.rejects(runValidationSuite(p, host, { onResult: async () => { throw new Error('quota exhausted'); } }), /quota exhausted/);
  assert.equal(loads, 1);
});
