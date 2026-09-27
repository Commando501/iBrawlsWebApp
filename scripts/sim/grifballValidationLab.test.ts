// Explicit UI integration command. Start the app on port 3000 before running it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { trialCheck } from '../../src/game/grifballValidation/runner';
import type { LabRun } from '../../src/game/grifballValidation/labReport';

const origin = 'http://localhost:3000';
async function records(page: Page): Promise<LabRun[]> {
  return page.evaluate(async () => new Promise((resolve, reject) => {
    const open = indexedDB.open('ibrawls-grifball-validation', 1);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('reports', 'readonly'), request = tx.objectStore('reports').getAll();
      tx.oncomplete = () => { db.close(); resolve(request.result.sort((a: any, b: any) => b.createdAt - a.createdAt)); };
      tx.onerror = () => reject(tx.error);
    }; open.onerror = () => reject(open.error);
  }));
}
async function openLab(page: Page) {
  await page.goto(origin, { waitUntil: 'load' });
  const notice = page.getByRole('button', { name: 'Got it', exact: true }); if (await notice.isVisible()) await notice.click();
  await page.getByRole('button', { name: 'Single Player', exact: true }).click();
  await page.getByRole('button', { name: 'AI Behavior Editor', exact: true }).click();
  await page.getByRole('button', { name: 'Grifball AI Lab · Team tactics and scenarios', exact: true }).click();
  await page.getByRole('tab', { name: 'Validation', exact: true }).click();
}
async function setManifest(page: Page, mode: 'scenario' | 'match', seconds = 3) {
  const m = createSuiteManifest(mode === 'scenario' ? 'quick' : 'standard');
  m.profile = 'quick'; m.requiredGates = createSuiteManifest('quick').requiredGates;
  m.cases = m.cases.filter(c => mode === 'scenario' ? c.scenario === 'goal' : c.roster === 'scripted-4v4');
  Object.assign(m.cases[0], { seeds: mode === 'scenario' ? [101, 102] : [101], mirrored: false, simulationSeconds: seconds });
  const details = page.locator('details').filter({ has: page.getByLabel('Validation manifest JSON', { exact: true }) });
  await details.evaluate((el: HTMLDetailsElement) => el.open = true);
  await page.getByLabel('Validation manifest JSON', { exact: true }).fill(JSON.stringify(m));
  await page.getByRole('button', { name: 'Use manifest', exact: true }).click();
  await page.getByRole('button', { name: 'Freeze inputs', exact: true }).click();
  await page.getByRole('button', { name: 'Run suite', exact: true }).waitFor({ state: 'visible' });
  return m;
}
async function finished(page: Page) {
  await page.getByRole('region', { name: 'Active validation run', exact: true }).waitFor({ state: 'hidden', timeout: 120000 });
  await page.getByRole('region', { name: 'Validation report', exact: true }).waitFor({ state: 'visible' });
}

test('Lab runs frozen jobs, pauses at boundaries, persists, imports, reruns and reports interruption at desktop and narrow widths', { timeout: 300000 }, async () => {
  const out = resolve('output/grifball-validation/vs4-lab-ui'); mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin !== origin || new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.continue());
  await context.routeWebSocket(/.*/, socket => socket.close());
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  try {
    await openLab(page);
    assert.equal(await page.evaluate(() => Boolean(window.__grifballValidation)), false, 'main Lab must not expose the automation hook');
    await page.getByLabel('Validation profile', { exact: true }).selectOption('acceptance');
    await page.getByText('Import an acceptance manifest', { exact: false }).waitFor();
    const manifest = await setManifest(page, 'scenario');
    await page.screenshot({ path: join(out, 'desktop-ready.png') });
    await page.getByRole('button', { name: 'Run suite', exact: true }).click();
    await page.getByRole('button', { name: 'Pause after job', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Paused between jobs' }).waitFor({ timeout: 60000 });
    let saved = (await records(page))[0]; assert.equal(saved.status, 'paused'); assert.equal(saved.results.length, 1);
    assert.equal(saved.results[0].termination, 'scenario-complete');
    console.log('Paused after a real trial, first checkpoint saved.');
    await page.getByRole('tab', { name: 'Tuning', exact: true }).click();
    await page.getByRole('tab', { name: 'Spacing', exact: true }).click();
    const spacing = page.getByRole('checkbox', { name: /^Custom spacing/ }); await spacing.setChecked(!(await spacing.isChecked()));
    await page.getByRole('tab', { name: 'Validation', exact: true }).click();
    assert.deepEqual((await records(page))[0].plan.manifest.candidate, manifest.candidate);
    await page.screenshot({ path: join(out, 'paused-report.png') });
    await page.getByRole('button', { name: 'Resume suite', exact: true }).click(); await finished(page);
    saved = (await records(page))[0]; assert.equal(saved.results.length, 4); assert.equal(saved.status, 'completed');
    assert.ok(saved.results.every(r => r.check.verdict === 'pass'));
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export report JSON', exact: true }).click();
    const jsonFile = join(out, 'completed-report.json'); await (await download).saveAs(jsonFile);
    const readable = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download readable report', exact: true }).click(); await (await readable).saveAs(join(out, 'completed-report.txt'));
    await openLab(page); await page.getByText('4/4 trials recorded', { exact: false }).waitFor();
    await page.getByLabel('Import validation report', { exact: true }).setInputFiles(jsonFile);
    await page.getByText('Imported reference only', { exact: false }).waitFor();
    const imported = (await records(page)).find(r => r.source === 'imported')!; assert.ok(imported); assert.notEqual(imported.id, saved.id);
    await page.getByRole('button', { name: 'Delete report', exact: true }).click();
    assert.ok(!(await records(page)).some(r => r.id === imported.id));
    const fault = JSON.parse(readFileSync(jsonFile, 'utf8')) as LabRun;
    fault.results[0].termination = 'invalid-state'; fault.results[0].check = trialCheck(fault.results[0].jobId, 'invalid-state', 'Injected ownership failure for report UI coverage');
    fault.results[0].failureState = { version: 1, stage: 'after-tick', tick: 61, lastValidTick: 60, ball: { state: 'held', holderId: 'missing', position: [] }, holder: null, actors: [], omittedActors: 0 };
    const failureFile = join(out, 'injected-failure.json'); writeFileSync(failureFile, JSON.stringify(fault));
    await page.getByLabel('Import validation report', { exact: true }).setInputFiles(failureFile);
    await page.getByText('Suite: fail · M7: fail', { exact: true }).waitFor();
    await page.locator('summary').filter({ hasText: /^goal-quick/ }).click();
    await page.getByText('Injected ownership failure for report UI coverage', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Rerun case goal-quick', exact: true }).click(); await finished(page);
    assert.ok((await records(page)).some(r => r.results.some(t => t.termination === 'invalid-state')), 'rerun must preserve previous failure');
    console.log('Completed, reloaded, exported/imported and reran a case; original failure retained.');
    await setManifest(page, 'match', 60);
    await page.getByRole('button', { name: 'Run suite', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^running/ }).waitFor({ timeout: 60000 });
    await page.getByLabel('Validation arena', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, 'eight-bot-arena.png') });
    await page.getByRole('button', { name: 'Cancel suite', exact: true }).click(); await finished(page);
    saved = (await records(page))[0]; assert.equal(saved.status, 'cancelled'); assert.equal(saved.results[0].termination, 'cancelled');
    assert.equal(saved.results[0].start!.alive.length, 8);
    await page.getByRole('button', { name: 'Run suite', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^running/ }).waitFor({ timeout: 60000 });
    const interruptedId = (await records(page))[0].id;
    await openLab(page); await page.getByText('Unfinished checkpoint — reload or another tab;', { exact: false }).waitFor();
    saved = (await records(page)).find(r => r.id === interruptedId)!; assert.equal(saved.results.length, 0); assert.ok(saved.currentJobId);
    await page.setViewportSize({ width: 390, height: 844 });
    const lab = page.getByRole('complementary', { name: 'Grifball AI Lab', exact: true });
    const bounds = await lab.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.width <= 390);
    const overflow = await page.getByRole('region', { name: 'Validation suite', exact: true }).evaluate(el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false, 'validation panel must fit a narrow viewport');
    await page.getByRole('region', { name: 'Validation report', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, 'narrow-interrupted.png') });
    await page.getByRole('button', { name: 'Collapse lab', exact: true }).click(); await page.getByRole('button', { name: 'Expand lab', exact: true }).click();
    assert.deepEqual(errors, []);
    writeFileSync(join(out, 'browser-evidence.json'), JSON.stringify({ browser: browser.version(), reports: (await records(page)).map(r => ({ id: r.id, status: r.status, trials: r.results.length })), errors }, null, 2));
    console.log('Eight-bot cancellation, reload interruption, and 390px layout verified.');
  } catch (e) {
    await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
    writeFileSync(join(out, 'failure-records.json'), JSON.stringify(await records(page).catch(() => [])));
    writeFileSync(join(out, 'failure-dom.txt'), await page.locator('body').ariaSnapshot().catch(() => 'unavailable'));
    throw e;
  } finally { await context.close(); await browser.close(); }
});

test('Lab stops on storage failure, exports unsaved evidence, excludes concurrent tabs and cancels on close', { timeout: 180000 }, async () => {
  const out = resolve('output/grifball-validation/vs4-lab-ui'); mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin !== origin || new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.continue());
  await context.routeWebSocket(/.*/, socket => socket.close());
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) {
        if (value?.format === 'grifball-lab-run' && value.results?.length) throw new DOMException('Injected report quota exhausted', 'QuotaExceededError');
        return key === undefined ? original.call(this, value) : original.call(this, value, key);
      };
    });
    await openLab(page); await setManifest(page, 'scenario', 1);
    await page.getByRole('button', { name: 'Run suite', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Injected report quota exhausted' }).waitFor({ timeout: 60000 });
    await finished(page);
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export report JSON', exact: true }).click();
    const file = join(out, 'quota-recovery.json'); await (await download).saveAs(file);
    const recovery = JSON.parse(readFileSync(file, 'utf8')) as LabRun;
    assert.equal(recovery.results.length, 1); assert.equal(recovery.status, 'error');
    assert.equal((await records(page))[0].results.length, 0, 'failed checkpoint must not fabricate stored evidence');
    await page.screenshot({ path: join(out, 'storage-failure.png') }); await page.close();
    const first = await context.newPage(); await openLab(first); await setManifest(first, 'scenario', 3);
    await first.getByRole('button', { name: 'Run suite', exact: true }).click();
    await first.getByRole('button', { name: 'Pause after job', exact: true }).click();
    await first.getByRole('status').filter({ hasText: 'Paused between jobs' }).waitFor({ timeout: 60000 });
    const second = await context.newPage(); await openLab(second); await setManifest(second, 'scenario', 1);
    await second.getByRole('button', { name: 'Run suite', exact: true }).click();
    await second.getByRole('alert').filter({ hasText: 'running in another tab' }).waitFor();
    await second.close();
    await first.getByRole('button', { name: 'Cancel suite', exact: true }).click(); await finished(first);
    const cancelled = (await records(first))[0]; assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.results.length, 1);
    await setManifest(first, 'match', 60); await first.getByRole('button', { name: 'Run suite', exact: true }).click();
    await first.getByRole('status').filter({ hasText: /^running/ }).waitFor({ timeout: 60000 });
    await first.getByRole('button', { name: 'Close lab', exact: true }).click();
    await first.waitForFunction(async () => new Promise<boolean>(resolve => {
      const open = indexedDB.open('ibrawls-grifball-validation', 1);
      open.onsuccess = () => { const db = open.result, tx = db.transaction('reports', 'readonly'), req = tx.objectStore('reports').getAll();
        tx.oncomplete = () => { db.close(); resolve(req.result.sort((a: any, b: any) => b.createdAt - a.createdAt)[0]?.status === 'cancelled'); }; };
    }));
    assert.equal((await records(first))[0].results[0].termination, 'cancelled');
    console.log('Quota recovery export, cross-tab exclusion, paused cancellation and close cancellation verified.');
  } finally { await context.close(); await browser.close(); }
});
