import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { canonicalJSON, createSuitePlan } from '../../src/game/grifballValidation/plan';
import { captureCodeIdentity } from './validateGrifball';
import { atomicJSON, digest, jobFile } from './grifballValidationArtifacts';
import { hashTree, nodeCheck } from './grifballValidationExecute';
import { productionStartup } from './grifballValidationBrowser';
import { startValidationServer } from './grifballValidationServer';
import { CROSS_HOST_PROTOCOL, runCrossHostJob } from './grifballCrossHost';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export async function main(args: string[]) {
  if (args.length !== 4 || args[0] !== '--manifest' || args[2] !== '--out')
    throw new Error('Usage: validateGrifballCrossHost --manifest FILE --out NEW-DIRECTORY');
  const out = resolve(args[3]);
  if (existsSync(out)) throw new Error('Cross-host output directory already exists');
  const plan = await createSuitePlan(JSON.parse(readFileSync(resolve(args[1]), 'utf8').replace(/^\uFEFF/, '')), captureCodeIdentity(ROOT));
  mkdirSync(out, { recursive: true });
  for (const name of ['logs', 'jobs', 'screenshots']) mkdirSync(join(out, name));
  atomicJSON(join(out, 'plan.json'), plan);
  const publicHash = hashTree(join(ROOT, 'public'));
  const lockHash = digest(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const buildId = digest({ code: plan.code, publicHash, lockHash, protocol: CROSS_HOST_PROTOCOL });
  const abort = new AbortController(), cancel = () => abort.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  let server: Awaited<ReturnType<typeof startValidationServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const jobs: { jobId: string; verdict: string; comparedFrames: number; failureCount: number }[] = [];
  const summary = (status: string, error: string | null = null) => atomicJSON(join(out, 'summary.json'), {
    protocol: CROSS_HOST_PROTOCOL, planId: plan.id, code: plan.code, status, error, expectedJobs: plan.jobs.length, jobs,
    scope: 'Production browser/Node state comparison; does not certify the independent legacy simulator, quality, performance or all M7 requirements.',
  });
  try {
    summary('preparing');
    for (const [name, command, env] of [
      ['typecheck', ['--max-old-space-size=8192', 'node_modules/typescript/bin/tsc', '--noEmit'], process.env],
      ['production-build', ['--max-old-space-size=8192', 'node_modules/vite/bin/vite.js', 'build', '--outDir', join(out, 'production')], process.env],
      ['validation-build', ['--max-old-space-size=8192', 'node_modules/vite/bin/vite.js', 'build', '--mode', 'validation', '--outDir', join(out, 'validation')],
        { ...process.env, GRIFBALL_VALIDATION_BUILD_ID: buildId }],
    ] as const) {
      console.log(`Running ${name}`);
      const status = await nodeCheck(ROOT, [...command], join(out, 'logs', `${name}.log`), abort.signal, env);
      if (status !== 0) throw new Error(`${name} exited ${status}`);
    }
    const assertSource = () => {
      if (canonicalJSON(captureCodeIdentity(ROOT)) !== canonicalJSON(plan.code) || publicHash !== hashTree(join(ROOT, 'public')) ||
        lockHash !== digest(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))) throw new Error('Source/assets changed during cross-host run');
    };
    assertSource();
    const identity = { protocol: CROSS_HOST_PROTOCOL, code: plan.code, publicHash, lockHash, buildId,
      productionHash: hashTree(join(out, 'production')), validationHash: hashTree(join(out, 'validation')) };
    server = await startValidationServer(identity, join(out, 'production'), join(out, 'validation'), 0);
    browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    atomicJSON(join(out, 'identity.json'), { ...identity, node: process.version, browser: browser.version(), platform: process.platform });
    await productionStartup(browser, server.origin, out, abort.signal);
    for (const job of plan.jobs) {
      if (abort.signal.aborted) throw new Error('Cross-host run cancelled');
      assertSource(); console.log(`Comparing ${job.id}`); summary('running');
      const result = await runCrossHostJob(browser, server.origin, buildId, plan, job, out, abort.signal);
      assertSource(); atomicJSON(join(out, 'jobs', jobFile(job.id)), result);
      jobs.push({ jobId: job.id, verdict: result.verdict, comparedFrames: result.comparedFrames, failureCount: result.failureCount });
      console.log(`${result.verdict}: ${result.comparedFrames} frames, ${result.failureCount} differences`); summary('running');
    }
    const failed = jobs.some(job => job.verdict !== 'pass');
    summary(failed ? 'fail' : 'pass'); return failed ? 1 : 0;
  } catch (error) {
    summary(abort.signal.aborted ? 'cancelled' : 'error', String(error)); throw error;
  } finally {
    try { await browser?.close(); } finally { await server?.close(); }
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(String(error)); process.exitCode = 3; });
