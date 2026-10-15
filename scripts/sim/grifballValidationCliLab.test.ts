// Explicit integration command: supply a fresh CLI lab-import.json and the matching production server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deterministicTrialValue } from '../../src/game/grifballValidation/gates';
import { importLabRun, UNKNOWN_CODE, type LabRun } from '../../src/game/grifballValidation/labReport';
import { captureCodeIdentity } from './validateGrifball';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';

test('fresh CLI and production Lab agree, and CLI reference provenance survives browser export', { timeout: 300000 }, async () => {
  assert.ok(process.env.GRIFBALL_CLI_LAB_REPORT, 'Set GRIFBALL_CLI_LAB_REPORT to a fresh CLI lab-import.json');
  const file = resolve(process.env.GRIFBALL_CLI_LAB_REPORT);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.format, 'grifball-cli-run');
  assert.equal(raw.status, 'completed');
  assert.equal(raw.error, null);
  assert.equal(raw.previousFailures, 0);
  assert.deepEqual(raw.plan.code, captureCodeIdentity(process.cwd()), 'CLI evidence must match the current source');
  const expected = await importLabRun(JSON.stringify(raw));
  assert.equal(expected.results.length, expected.plan.jobs.length, 'CLI must have run every selected manifest job');
  assert.ok(expected.results.length > 0, 'Agreement requires real trial evidence');
  assert.ok(expected.results.every(r => ['scenario-complete', 'match-end', 'simulation-cap'].includes(r.termination)), 'No failed or interrupted CLI trials');
  const origin = new URL(process.env.GRIFBALL_LAB_TEST_ORIGIN ?? 'http://localhost:3000').origin;
  const out = resolve(process.env.GRIFBALL_LAB_TEST_OUT ?? 'output/grifball-validation/cli-lab-agreement');
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin !== origin || new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.continue());
  await context.routeWebSocket(/.*/, socket => socket.close());
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  const download = async (path: string) => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export report JSON', exact: true }).click();
    await (await event).saveAs(path);
    return await importLabRun(readFileSync(path, 'utf8'));
  };
  try {
    await page.goto(origin, { waitUntil: 'load' });
    const notice = page.getByRole('button', { name: 'Got it', exact: true }); if (await notice.isVisible()) await notice.click();
    await page.getByRole('button', { name: 'Single Player', exact: true }).click();
    await page.getByRole('button', { name: 'AI Behavior Editor', exact: true }).click();
    await page.getByRole('button', { name: 'Grifball AI Lab · Team tactics and scenarios', exact: true }).click();
    await page.getByRole('tab', { name: 'Validation', exact: true }).click();
    await page.getByLabel('Import validation report', { exact: true }).setInputFiles(file);
    await page.getByText('Imported reference only', { exact: false }).waitFor();
    const reference = await download(join(out, 'cli-reference-export.json'));
    assert.deepEqual(reference.cliIdentity, expected.cliIdentity);
    assert.deepEqual(reference.cliGates, expected.cliGates);
    assert.deepEqual(reference.results, expected.results);
    assert.equal(reference.cliPreviousFailures, 0);
    await page.screenshot({ path: join(out, 'cli-reference.png') });
    const details = page.locator('details').filter({ has: page.getByLabel('Validation manifest JSON', { exact: true }) });
    await details.evaluate((el: HTMLDetailsElement) => el.open = true);
    await page.getByLabel('Validation manifest JSON', { exact: true }).fill(JSON.stringify(expected.plan.manifest));
    await page.getByRole('button', { name: 'Use manifest', exact: true }).click();
    await page.getByRole('button', { name: 'Freeze inputs', exact: true }).click();
    await page.getByRole('button', { name: 'Run suite', exact: true }).click();
    await page.getByRole('region', { name: 'Active validation run', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('region', { name: 'Active validation run', exact: true }).waitFor({ state: 'hidden', timeout: 180000 });
    const path = join(out, 'lab-run.json'); await download(path);
    const local = JSON.parse(readFileSync(path, 'utf8')) as LabRun;
    assert.equal(local.source, 'local'); assert.equal(local.status, 'completed');
    assert.equal(local.cliIdentity, undefined, 'Fresh local runs cannot inherit CLI certification');
    assert.equal(local.cliGates, undefined);
    assert.deepEqual(local.plan.manifest, expected.plan.manifest);
    // Browser runs deliberately have unknown source identity, which changes job hashes.
    // Reconstruct that identity explicitly; all simulation inputs must still agree.
    const browserPlan = await createSuitePlan(expected.plan.manifest, UNKNOWN_CODE);
    assert.deepEqual(local.plan, browserPlan);
    assert.equal(local.results.length, expected.results.length);
    for (const result of expected.results) {
      const cliIndex = expected.plan.jobs.findIndex(j => j.id === result.jobId);
      const cliJob = expected.plan.jobs[cliIndex], browserJob = browserPlan.jobs[cliIndex];
      assert.deepEqual({ ...browserJob, id: cliJob.id, inputHash: cliJob.inputHash }, cliJob, 'Only source-dependent identity differs');
      const actual = local.results.find(r => r.jobId === browserJob.id);
      assert.ok(actual, 'Every CLI job has a Lab counterpart');
      assert.deepEqual(deterministicTrialValue(actual), deterministicTrialValue(result), result.jobId);
      assert.deepEqual(actual.check.evidence, ['trial:' + actual.jobId]);
      assert.deepEqual(result.check.evidence, ['trial:' + result.jobId]);
      assert.deepEqual({ ...actual.check, id: result.check.id, evidence: result.check.evidence }, result.check);
    }
    await page.getByRole('region', { name: 'Validation report', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, 'lab-agreement.png') });
    assert.deepEqual(errors, []);
    writeFileSync(join(out, 'agreement.json'), JSON.stringify({ source: raw.plan.code, browser: browser.version(),
      jobs: expected.results.map(r => ({ id: r.jobId, termination: r.termination, stateHash: r.deterministic?.hash })),
      deterministicAgreement: true, cliProvenancePreserved: true, localRunRemainsUncertified: true, errors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
    writeFileSync(join(out, 'failure-dom.txt'), await page.locator('body').ariaSnapshot().catch(() => 'unavailable'));
    throw error;
  } finally { await context.close(); await browser.close(); }
});
