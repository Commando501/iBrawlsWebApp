import { cpus, totalmem, release } from 'node:os';
import { correctnessGate, reproducibilityGate, createNullControlPlan, nullControlRequired, validateGateProtocol, gate } from '../../src/game/grifballValidation/gates';
import { qualityGate } from '../../src/game/grifballValidation/qualityGate';
import { performanceGate } from '../../src/game/grifballValidation/performanceGate';
import { runExecutionParity } from './grifballExecutionParity';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Browser, type BrowserServer } from 'playwright';
import { canonicalJSON } from '../../src/game/grifballValidation/plan';
import type { CheckResult, SuitePlan } from '../../src/game/grifballValidation/types';
import { atomicJSON, digest, RunArtifacts } from './grifballValidationArtifacts';
import { bounded, labControlsSmoke, productionStartup, runBrowserJob } from './grifballValidationBrowser';
import { startValidationServer } from './grifballValidationServer';
import { captureCodeIdentity, type Options } from './validateGrifball';

const require = createRequire(import.meta.url);
export function hashTree(directory: string): string {
  const hash = createHash('sha256');
  const visit = (path: string, relative: string) => {
    for (const name of readdirSync(path).sort()) {
      const absolute = join(path, name), label = relative + name, stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Validation build cannot fingerprint symlink ${absolute}`);
      if (stat.isDirectory()) visit(absolute, label + '/');
      else if (stat.isFile()) { hash.update(label + '\0'); hash.update(createHash('sha256').update(readFileSync(absolute)).digest()); }
    }
  };
  visit(directory, ''); return hash.digest('hex');
}
async function nodeCheck(root: string, args: string[], logPath: string, signal: AbortSignal, env: NodeJS.ProcessEnv = process.env) {
  if (signal.aborted) throw new Error('Validation cancelled');
  const fd = openSync(logPath, 'wx');
  const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd] });
  try {
    const status = await bounded(new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? -1)); }), 30 * 60 * 1000, signal);
    return status;
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* Process may have exited between the check and termination. */ }
    }
    closeSync(fd);
  }
}
const check = (id: string, success: boolean, summary: string, evidence: string): CheckResult => ({
  id, state: 'completed', verdict: success ? 'pass' : 'fail', summary, evidence: [evidence],
});
export async function executeValidation(root: string, plan: SuitePlan, options: Options): Promise<number> {
  if (options.case && !plan.cases.some(c => c.specification.id === options.case)) throw new Error(`Unknown case ${options.case}`);
  if (options.resume && !existsSync(join(resolve(options.resume), 'identity.json'))) throw new Error('Resume directory lacks completed build/runtime identity');
  const directory = resolve(options.out ?? join(root, 'output/grifball-validation', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)));
  const protocol = options.protocol ? validateGateProtocol(JSON.parse(readFileSync(resolve(options.protocol), 'utf8').replace(/^\uFEFF/, ''))) : undefined;
  const artifacts = new RunArtifacts(directory, plan, options.case ?? null);
  atomicJSON(join(directory, 'gate-protocol.json'), protocol ?? null);
  let testsPassed = true;
  let environmentHash: string | null = null;
  let control: ReturnType<typeof reproducibilityGate> | undefined;
  console.log(`Artifacts: ${directory}`);
  const abort = new AbortController();
  const cancel = () => { console.log('Cancellation requested; retaining completed evidence.'); abort.abort(); };
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  let server: Awaited<ReturnType<typeof startValidationServer>> | undefined;
  let browserServer: BrowserServer | undefined, browser: Browser | undefined;
  let cancelled = false;
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const playwrightVersion = require('playwright/package.json').version;
    if (pkg.devDependencies.playwright !== playwrightVersion) throw new Error('Installed Playwright differs from the exact package.json pin; run npm ci');
    if (!existsSync(chromium.executablePath())) throw new Error('Pinned Chromium is missing; run npm run validate:grifball:install');
    const lockHash = createHash('sha256').update(readFileSync(join(root, 'package-lock.json'))).digest('hex');
    const publicHash = hashTree(join(root, 'public'));
    const buildId = digest({ code: plan.code, lockHash, publicHash });
    const command = async (name: string, args: string[], env?: NodeJS.ProcessEnv) => {
      console.log(`Running ${name}...`);
      const log = `logs/${name}.log`;
      const status = await nodeCheck(root, args, join(directory, log), abort.signal, env);
      atomicJSON(join(directory, `${name}.json`), { args, status, log });
      console.log(`${name}: exit ${status}`); return { status, log };
    };
    const fullTests = plan.manifest.requiredGates.includes('repository-tests');
    const testArgs = (fullTests ? pkg.scripts.test : pkg.scripts['test:grifball-validation']).split(/\s+/);
    if (testArgs.shift() !== 'node') throw new Error('Expected a Node test command');
    const tests = await command(fullTests ? 'repository-tests' : 'focused-tests', testArgs);
    testsPassed = tests.status === 0;
    if (fullTests) artifacts.gates.push(check('repository-tests', tests.status === 0, `Repository tests exited ${tests.status}; see complete output.`, tests.log));
    else if (tests.status !== 0) artifacts.gates.push(check('correctness', false, 'Focused Node checks failed; gameplay correctness cannot pass.', tests.log));
    artifacts.checkpoint('checking');
    const types = await command('typecheck', ['--max-old-space-size=8192', 'node_modules/typescript/bin/tsc', '--noEmit']);
    artifacts.gates.push(check('typecheck', types.status === 0, `TypeScript exited ${types.status}.`, types.log));
    artifacts.checkpoint('building');
    const production = join(directory, 'production'), validation = join(directory, 'validation');
    const prod = await command('production-build', ['--max-old-space-size=8192', 'node_modules/vite/bin/vite.js', 'build', '--outDir', production]);
    const relay = await command('relay-build', ['node_modules/esbuild/bin/esbuild', 'server.ts', '--bundle', '--platform=node', '--format=cjs', '--packages=external', '--sourcemap', `--outfile=${join(production, 'server.cjs')}`]);
    const live = await command('validation-build', ['--max-old-space-size=8192', 'node_modules/vite/bin/vite.js', 'build', '--mode', 'validation', '--outDir', validation], { ...process.env, GRIFBALL_VALIDATION_BUILD_ID: buildId });
    artifacts.gates.push(check('build', prod.status === 0 && relay.status === 0 && live.status === 0, 'Production client, relay and explicit validation build.', 'production-build.json, relay-build.json, validation-build.json'));
    artifacts.checkpoint('starting');
    if (prod.status || relay.status || live.status) return artifacts.exitCode();
    if (canonicalJSON(captureCodeIdentity(root)) !== canonicalJSON(plan.code) || publicHash !== hashTree(join(root, 'public')))
      throw new Error('Source or public assets changed during preparation; start a new frozen run');
    const launch = { channel: 'chromium' as const, headless: true as const, args: ['--autoplay-policy=no-user-gesture-required'] };
    browserServer = await chromium.launchServer({ ...launch, timeout: 30000 });
    browser = await chromium.connect(browserServer.wsEndpoint());
    artifacts.setIdentity({ schemaVersion: 1, code: plan.code, node: process.version, platform: process.platform, arch: process.arch,
      playwright: playwrightVersion, browser: browser.version(), executableHash: createHash('sha256').update(readFileSync(chromium.executablePath())).digest('hex'),
      launch, lockHash, productionHash: hashTree(production), validationHash: hashTree(validation), buildId });
    const probe = await browser.newContext();
    let graphics: unknown;
    try {
      const page = await probe.newPage();
      graphics = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const extension = gl?.getExtension('WEBGL_debug_renderer_info');
        return { hardwareConcurrency: navigator.hardwareConcurrency, userAgent: navigator.userAgent,
          renderer: gl && extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null };
      });
    } finally { await probe.close(); }
    const environment = { graphics, platform: process.platform, arch: process.arch, os: release(), cpus: cpus().map(c => c.model), memory: totalmem(),
      node: process.version, browser: browser.version(), executableHash: artifacts.identity!.executableHash, launch };
    environmentHash = digest(environment);
    atomicJSON(join(directory, 'measurement-environment.json'), { environment, environmentHash, protocol: protocol?.performance ?? null });
    artifacts.recordGate(runExecutionParity());
    if (options.resume) {
      const oldProtocol = join(resolve(options.resume), 'gate-protocol.json');
      if (!existsSync(oldProtocol) || canonicalJSON(JSON.parse(readFileSync(oldProtocol, 'utf8'))) !== canonicalJSON(protocol ?? null)) throw new Error('Resume gate protocol differs; use a fresh run');
      artifacts.resume(options.resume);
    }
    server = await startValidationServer(artifacts.identity, production, validation);
    try {
      await productionStartup(browser, server.origin, directory, abort.signal);
      artifacts.gates.push(check('startup', true, 'Normal production document rendered with no validation hook or failed local assets.', 'screenshots/production-startup.png'));
    } catch (error) {
      if (abort.signal.aborted) throw error;
      artifacts.gates.push(check('startup', false, String(error), 'logs/production-startup.log'));
    }
    if (plan.manifest.requiredGates.includes('lab-ui')) {
      try {
        await labControlsSmoke(browser, server.origin, directory, abort.signal);
        artifacts.gates.push(check('lab-ui', true, 'Production Lab opens, changes/restores spacing, collapses, expands and closes through visible controls.', 'screenshots/lab-controls.png'));
      } catch (error) {
        if (abort.signal.aborted) throw error;
        artifacts.gates.push(check('lab-ui', false, String(error), 'logs/lab-ui.log'));
      }
    }
    if (nullControlRequired(plan)) {
      const nullPlan = await createNullControlPlan(plan), controls = new RunArtifacts(join(directory, 'null-control'), nullPlan, null);
      controls.setIdentity(artifacts.identity!);
      for (const job of nullPlan.jobs) {
        if (abort.signal.aborted) break;
        console.log(`Null control ${job.id}`);
        controls.save(await runBrowserJob(browser, server.origin, buildId, nullPlan, job, controls.directory, abort.signal));
        if (!['scenario-complete', 'match-end', 'simulation-cap'].includes(controls.results.at(-1)!.termination)) break;
      }
      control = reproducibilityGate(nullPlan, controls.results, true); controls.recordGate(control); controls.checkpoint('finished');
      artifacts.recordGate({ ...control, details: { controlPlan: nullPlan.id, directory: 'null-control', evaluation: control.details } });
      if (control.check.verdict !== 'pass') console.log('Null control did not pass; candidate matrix remains not run.');
    }
    artifacts.checkpoint('running');
    for (const job of plan.jobs) {
      if (control && control.check.verdict !== 'pass') break;
      if (abort.signal.aborted) break;
      if (options.case && job.caseId !== options.case || artifacts.results.some(r => r.jobId === job.id)) continue;
      artifacts.activeJob = job.id; artifacts.checkpoint('running');
      console.log(`Running ${job.id}`);
      const result = await runBrowserJob(browser, server.origin, buildId, plan, job, directory, abort.signal);
      artifacts.save(result);
      console.log(`${result.termination}: ${result.check.summary}`);
      // A broken renderer/session must not produce cascaded misleading results for the rest of the queue.
      if (result.termination === 'watchdog' || result.termination === 'setup-error') break;
    }
  } catch (error) {
    cancelled = abort.signal.aborted;
    if (!cancelled) artifacts.setupError = error instanceof Error ? error.message : String(error);
    console.error(cancelled ? 'Run cancelled.' : `Runner/setup error: ${artifacts.setupError}`);
  } finally {
    cancelled ||= abort.signal.aborted;
    try { if (browserServer) await bounded(browserServer.kill(), 5000); }
    catch (error) { artifacts.setupError ??= `Browser cleanup failed: ${String(error)}`; }
    try { await server?.close(); } catch (error) { artifacts.setupError ??= `Server cleanup failed: ${String(error)}`; }
    const correctness = correctnessGate(plan, artifacts.results);
    artifacts.recordGate(testsPassed ? correctness : gate('correctness', 'fail', 'Node checks failed; see test log.', correctness.details));
    artifacts.recordGate(control ? { ...control, details: { control: 'null-control', evaluation: control.details } } : reproducibilityGate(plan, artifacts.results, Boolean(artifacts.identity)));
    artifacts.recordGate(qualityGate(plan, artifacts.results, artifacts.gates.find(g => g.id === 'reproducibility')!, protocol));
    artifacts.recordGate(performanceGate(plan, artifacts.results, environmentHash, protocol));
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    artifacts.checkpoint(cancelled ? 'cancelled' : artifacts.setupError ? 'error' : 'finished');
  }
  const exitCode = artifacts.exitCode();
  if (cancelled) artifacts.checkpoint('cancelled');
  console.log(`Report: ${join(directory, 'report.html')}\nExit ${exitCode}: ${exitCode === 0 ? 'required automated gates passed' : exitCode === 1 ? 'failed evidence' : exitCode === 2 ? 'incomplete evidence' : 'runner/setup error'}`);
  return exitCode;
}
