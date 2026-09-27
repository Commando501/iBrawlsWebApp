import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import { trialCheck, type TrialResult } from '../../src/game/grifballValidation/runner';
import { atomicJSON, jobFile, readJSON, RunArtifacts, type RunIdentity } from './grifballValidationArtifacts';
import { bounded, failedTrial, WatchdogError } from './grifballValidationBrowser';
import { startValidationServer, IDENTITY_PATH } from './grifballValidationServer';

function temporary(t: TestContext) {
  const parent = resolve('output'); mkdirSync(parent, { recursive: true }); const dir = mkdtempSync(join(parent, 'ibrawls-vs3-'));
  t.after(async () => { assert.equal(dirname(resolve(dir)), parent); assert.ok(basename(dir).startsWith('ibrawls-vs3-')); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return dir;
}
async function fixture() {
  const manifest = createSuiteManifest('quick'); manifest.cases = manifest.cases.slice(0, 1);
  manifest.cases[0].seeds = [101]; manifest.cases[0].mirrored = false;
  const plan = await createSuitePlan(manifest, { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src'] });
  const identity: RunIdentity = { schemaVersion: 1, code: plan.code, node: 'test', platform: 'test', arch: 'test', playwright: 'pinned', browser: 'pinned', executableHash: 'exe', launch: { channel: 'chromium', headless: true, args: [] }, lockHash: 'lock', productionHash: 'production', validationHash: 'validation', buildId: 'build' };
  const result: TrialResult = { ...failedTrial(plan.jobs[0], 'scenario-complete', 'Completed'), check: trialCheck(plan.jobs[0].id, 'scenario-complete', 'Completed') };
  return { plan, identity, result };
}
test('durable evidence refuses overwrites, escapes report content and keeps missing gates incomplete', async t => {
  const { plan, identity, result } = await fixture(), dir = join(temporary(t), 'run');
  const out = new RunArtifacts(dir, plan, null); out.setIdentity(identity);
  result.check.summary = '<script>unsafe</script>'; out.save(result);
  assert.equal(out.exitCode(), 2); assert.throws(() => out.save(result), /Duplicate/);
  assert.throws(() => new RunArtifacts(dir, plan, null), /already exists/);
  assert.match(readFileSync(join(dir, 'report.html'), 'utf8'), /&lt;script&gt;/);
  assert.equal(readJSON<any>(join(dir, 'jobs', jobFile(result.jobId))).resultHash.length, 64);
  out.setupError = 'test setup failure'; out.checkpoint('error'); assert.equal(out.exitCode(), 3);
  assert.equal(readJSON<any>(join(dir, 'summary.json')).status, 'error');
});
test('resume checks all identities, verifies persisted results and retains failed attempt history', async t => {
  const { plan, identity, result } = await fixture(), dir = temporary(t);
  const first = new RunArtifacts(join(dir, 'first'), plan, null); first.setIdentity(identity); first.save(result);
  first.save(failedTrial(plan.jobs[1], 'invalid-state', 'Injected invalid health'));
  first.gates.push({ id: 'startup', state: 'completed', verdict: 'fail', summary: 'Earlier failed startup', evidence: [] }); first.checkpoint('finished');
  const next = new RunArtifacts(join(dir, 'next'), plan, null); next.setIdentity(identity); next.resume(first.directory);
  assert.deepEqual(next.results, [result]); assert.equal(next.previous?.failures.length, 1); assert.equal(next.previous?.failedChecks.length, 1); assert.equal(next.exitCode(), 1);
  const last = new RunArtifacts(join(dir, 'last'), plan, null); last.setIdentity(identity); last.resume(next.directory); assert.equal(last.exitCode(), 1);
  for (const key of ['browser', 'lockHash', 'validationHash', 'productionHash'] as const) {
    const bad = new RunArtifacts(join(dir, key), plan, null); bad.setIdentity({ ...identity, [key]: 'changed' });
    assert.throws(() => bad.resume(first.directory), /differ/);
  }
  const path = join(first.directory, 'jobs', jobFile(result.jobId)), artifact = readJSON<any>(path);
  artifact.result.termination = 'invalid-state'; atomicJSON(path, artifact);
  const corrupt = new RunArtifacts(join(dir, 'corrupt'), plan, null); corrupt.setIdentity(identity);
  assert.throws(() => corrupt.resume(first.directory), /corrupt/);
});
test('rerun-by-case retains history and never copies jobs into the new attempt', async t => {
  const { plan, identity, result } = await fixture(), dir = temporary(t);
  const first = new RunArtifacts(join(dir, 'first'), plan, null); first.setIdentity(identity); first.save(result);
  const rerun = new RunArtifacts(join(dir, 'rerun'), plan, plan.cases[0].specification.id); rerun.setIdentity(identity); rerun.resume(first.directory);
  assert.equal(rerun.results.length, 0); assert.equal(rerun.previous?.directory, first.directory);
});
test('hard-killed writer retains completed job files and restarts the interrupted job', async t => {
  const { plan, identity, result } = await fixture(), dir = temporary(t), run = join(dir, 'killed');
  const moduleUrl = pathToFileURL(resolve('scripts/sim/grifballValidationArtifacts.ts')).href;
  const script = `import { RunArtifacts } from ${JSON.stringify(moduleUrl)}; const out = new RunArtifacts(${JSON.stringify(run)}, ${JSON.stringify(plan)}, null); out.setIdentity(${JSON.stringify(identity)}); out.save(${JSON.stringify(result)}); out.activeJob = ${JSON.stringify(plan.jobs[1].id)}; out.checkpoint('running'); console.log('ready'); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', data => { errors += data; });
  try {
    await bounded(new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); child.once('exit', code => reject(new Error(`Writer exited ${code}: ${errors}`))); }), 10000);
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill('SIGKILL'); await exited;
    const recovered = new RunArtifacts(join(dir, 'recovered'), plan, null); recovered.setIdentity(identity); recovered.resume(run);
    assert.deepEqual(recovered.results, [result]); assert.equal(recovered.previous?.interruptedJob, plan.jobs[1].id);
    assert.equal(recovered.exitCode(), 2);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});
test('external deadline and cancellation do not need a cooperative work promise', async () => {
  await assert.rejects(bounded(new Promise(() => {}), 15), WatchdogError);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(bounded(new Promise(() => {}), 10000, abort.signal), /cancelled/);
});
test('static server verifies a matching listener, protects assets and never closes a reused server', async t => {
  const dir = temporary(t), production = join(dir, 'production'), validation = join(dir, 'validation');
  mkdirSync(production); mkdirSync(validation); writeFileSync(join(production, 'index.html'), 'Production'); writeFileSync(join(validation, 'grifball-validation.html'), 'Validation');
  const identity = { version: 1, build: 'expected' }, server = await startValidationServer(identity, production, validation, 0);
  try {
    const port = Number(new URL(server.origin).port);
    assert.equal(await (await fetch(server.origin)).text(), 'Production');
    assert.equal(await (await fetch(server.origin + '/validation/grifball-validation.html')).text(), 'Validation');
    assert.equal((await fetch(server.origin + '/missing.js')).status, 404);
    assert.equal((await fetch(server.origin + '/validation/%2e%2e%5cpackage.json')).status, 404);
    const reused = await startValidationServer(identity, production, validation, port); assert.equal(reused.owned, false); await reused.close();
    assert.deepEqual(await (await fetch(server.origin + IDENTITY_PATH)).json(), identity);
    await assert.rejects(startValidationServer({ ...identity, build: 'other' }, production, validation, port), /occupied/);
    assert.equal(await (await fetch(server.origin)).text(), 'Production');
  } finally { await server.close(); }
});


test('structured failure diagnostics survive durable writes and resume history', async t => {
  const { plan, identity } = await fixture(), dir = temporary(t);
  const result = failedTrial(plan.jobs[0], 'invalid-state', 'Invalid ball holder');
  result.failureState = { version: 1, stage: 'after-tick', tick: 206, lastValidTick: 205,
    ball: { holderId: 'carrier', state: 'held', position: [0, 1, 0] },
    holder: { id: 'carrier', hp: 0, respawnTimer: 3, weapon: 'ball' }, actors: [], omittedActors: 0 };
  const first = new RunArtifacts(join(dir, 'first'), plan, null); first.setIdentity(identity); first.save(result);
  const saved = readJSON<any>(join(first.directory, 'jobs', jobFile(result.jobId)));
  assert.deepEqual(saved.result.failureState, result.failureState);
  const next = new RunArtifacts(join(dir, 'next'), plan, null); next.setIdentity(identity); next.resume(first.directory);
  assert.deepEqual(next.previous!.failures[0].failureState, result.failureState); assert.equal(next.exitCode(), 1);
  assert.match(readFileSync(join(next.directory, 'report.html'), 'utf8'), /valid frames only/);
});
