import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import { trialCheck, type TrialResult } from '../../src/game/grifballValidation/runner';
import { atomicJSON, jobFile, readJSON, RunArtifacts, writeParityEvidence, type RunIdentity } from './grifballValidationArtifacts';
import { nodeCheck, validationTestCommand } from './grifballValidationExecute';
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


test('parity evidence serializes bounded traces without stringifying the aggregate', async t => {
  const { plan } = await fixture(), out = new RunArtifacts(join(temporary(t), 'run'), plan, null);
  const traces = Array.from({ length: 80 }, (_, i) => ({ name: `trace-${i}`, frames: [{ tick: 1, optional: undefined, text: '☃\n"' }], differenceCount: 0 }));
  const details = { protocol: 'fixture', traces, empty: [], omitted: undefined, diagnostic: null, flag: false };
  const evaluation = { check: { id: 'execution-parity', state: 'completed' as const, verdict: 'inconclusive' as const,
    summary: 'Bounded evidence', evidence: ['gates/execution-parity.json'] }, details };
  const original = JSON.stringify;
  const expected = JSON.parse(original(evaluation));
  const stringify = t.mock.method(JSON, 'stringify', (value: unknown, replacer?: any, space?: any) => {
    if (value === evaluation || value === details || value === traces) throw new RangeError('Aggregate exceeds string limit');
    return original(value, replacer, space);
  });
  out.recordGate(evaluation);
  stringify.mock.restore();
  assert.deepEqual(readJSON(join(out.directory, 'gates/execution-parity.json')), expected);
  assert.equal(out.gates.length, 1);
});

test('failed parity serialization cannot replace valid evidence or update its verdict', async t => {
  const { plan } = await fixture(), out = new RunArtifacts(join(temporary(t), 'run'), plan, null);
  const check = { id: 'execution-parity', state: 'completed' as const, verdict: 'inconclusive' as const,
    summary: 'Existing evidence', evidence: ['gates/execution-parity.json'] };
  out.recordGate({ check, details: { traces: [{ name: 'saved' }] } });
  const path = join(out.directory, 'gates/execution-parity.json'), before = readFileSync(path, 'utf8');
  assert.throws(() => out.recordGate({ check: { ...check, verdict: 'fail' }, details: {
    traces: [{ name: 'partial' }, { toJSON() { throw new Error('Injected trace serialization failure'); } }],
  } }), /Injected trace serialization failure/);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.deepEqual(out.gates, [check]);
});

test('CLI selects smoke, explicit parity, and complete repository scope without weakening required checks', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  const quick = createSuiteManifest('quick');
  const smoke = validationTestCommand(quick, scripts);
  assert.equal(smoke.script, 'test:grifball-smoke');
  assert.equal(smoke.parity, false);
  assert.ok(smoke.args.includes('scripts/sim/grifballValidationExecute.test.ts'));
  assert.ok(!smoke.args.includes('src/game/grifballValidation/gates.test.ts'), 'Quick must not run the full parity aggregate');
  quick.requiredGates.push('execution-parity');
  const explicit = validationTestCommand(quick, scripts);
  assert.equal(explicit.script, 'test:grifball-validation');
  assert.equal(explicit.parity, true);
  assert.ok(explicit.args.includes('src/game/grifballValidation/gates.test.ts'));
  const standard = validationTestCommand(createSuiteManifest('standard'), scripts);
  assert.equal(standard.repository, true);
  assert.equal(standard.parity, true);
  assert.deepEqual(standard.args.slice(1), scripts.test.split(/\s+/).slice(1), 'Every repository check, including V3, remains selected');
  assert.equal(standard.args[0], '--max-old-space-size=8192');
  assert.throws(() => validationTestCommand(createSuiteManifest('quick'), {}), /Expected a Node/);
});

test('parity completion receipt is published only after durable full evidence', async t => {
  const { plan } = await fixture(), out = new RunArtifacts(join(temporary(t), 'run'), plan, null);
  const check = { id: 'execution-parity', state: 'completed' as const, verdict: 'inconclusive' as const,
    summary: 'Known coverage gaps', evidence: ['gates/execution-parity.json'] };
  assert.throws(() => writeParityEvidence(out.directory, { check, details: {
    traces: [{ toJSON() { throw new Error('Interrupted serialization'); } }],
  } }), /Interrupted serialization/);
  assert.equal(existsSync(join(out.directory, 'execution-parity-check.json')), false);
  assert.equal(existsSync(join(out.directory, 'gates/execution-parity.json')), false);
  const evidence = { check, details: { traces: [{ differenceCount: 0 }], gaps: ['uncovered'] } };
  writeParityEvidence(out.directory, evidence);
  assert.deepEqual(readJSON(join(out.directory, 'execution-parity-check.json')), check);
  assert.deepEqual(readJSON(join(out.directory, 'gates/execution-parity.json')), evidence);
});

test('cancellation interrupts a CPU-bound Node check and terminates its owned process', { timeout: 15000 }, async t => {
  const path = join(temporary(t), 'busy.log'), abort = new AbortController();
  const running = nodeCheck(process.cwd(), ['-e', 'console.log(process.pid); while (true) {}'], path, abort.signal);
  // Attach the rejection handler before cancellation to avoid an unhandled rejection.
  const rejected = assert.rejects(running, /cancelled/);
  try {
    const until = Date.now() + 10000;
    while ((!existsSync(path) || !readFileSync(path, 'utf8').trim()) && Date.now() < until)
      await new Promise(resolve => setTimeout(resolve, 25));
    const pid = Number(readFileSync(path, 'utf8').trim());
    assert.ok(Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    abort.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { abort.abort(); await rejected; }
});

test('Node checks preserve exit failures, enforce a watchdog and reject pre-cancelled work', async t => {
  const dir = temporary(t), signal = new AbortController().signal;
  assert.equal(await nodeCheck(process.cwd(), ['-e', 'process.exit(7)'], join(dir, 'failed.log'), signal), 7);
  await assert.rejects(nodeCheck(process.cwd(), ['-e', 'while (true) {}'], join(dir, 'timeout.log'), signal, process.env, 250), WatchdogError);
  const abort = new AbortController(); abort.abort();
  const path = join(dir, 'not-started.log');
  await assert.rejects(nodeCheck(process.cwd(), ['-e', 'process.exit(0)'], path, abort.signal), /cancelled/);
  assert.equal(existsSync(path), false);
});
