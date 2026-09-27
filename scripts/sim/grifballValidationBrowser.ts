import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type {} from '../../src/game/grifballValidation/browserBridge';
import { trialCheck, type TrialResult, type TrialTermination } from '../../src/game/grifballValidation/runner';
import type { SuitePlan, ValidationJob } from '../../src/game/grifballValidation/types';
import { jobFile } from './grifballValidationArtifacts';

export class WatchdogError extends Error {}
/** The timer lives in Node, independently of the renderer's event loop. */
export async function bounded<T>(work: Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WatchdogError('External wall-clock watchdog expired')), milliseconds);
    cancel = () => reject(new Error('Validation cancelled'));
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  });
  try { return await Promise.race([work, deadline]); }
  finally { clearTimeout(timer); if (cancel) signal?.removeEventListener('abort', cancel); }
}
export function failedTrial(job: ValidationJob, termination: TrialTermination, message: string): TrialResult {
  return { jobId: job.id, termination, check: trialCheck(job.id, termination, message), start: null, end: null,
    trace: [], droppedTraceEntries: 0, metrics: null, simulationCost: { samples: 0, meanMs: 0, maxMs: 0 } };
}
export async function isolatedContext(browser: Browser, origin: string, log: (message: string) => void) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'UTC',
    serviceWorkers: 'block', permissions: [], acceptDownloads: false });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    log(`Blocked non-validation request: ${url.href}`); return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => { log(`Blocked WebSocket: ${socket.url()}`); socket.close(); });
  return context;
}
function watchPage(page: Page, log: (message: string) => void, failures: string[]) {
  const fail = (message: string) => { if (failures.length < 50) failures.push(message.slice(0, 1000)); log(message); };
  page.on('console', message => { log(`console.${message.type()}: ${message.text()}`); if (message.type() === 'error') fail(message.text()); });
  page.on('pageerror', error => fail(`Uncaught: ${error.message}`));
  page.on('crash', () => fail('Browser renderer crashed'));
  page.on('requestfailed', request => fail(`Resource failed: ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) fail(`HTTP ${response.status()}: ${response.url()}`); });
}
export async function runBrowserJob(browser: Browser, origin: string, buildId: string, plan: SuitePlan, job: ValidationJob,
  directory: string, signal: AbortSignal): Promise<TrialResult> {
  let context: BrowserContext | undefined, page: Page | undefined;
  const failures: string[] = [];
  let lines = 0;
  const name = jobFile(job.id).replace('.json', '');
  const log = (message: string) => { if (++lines <= 2000) appendFileSync(join(directory, 'logs', `${name}.log`), `${message.slice(0, 4000)}\n`);
    else if (lines === 2001) appendFileSync(join(directory, 'logs', `${name}.log`), 'Further browser logging truncated.\n'); };
  const work = (async () => {
    context = await isolatedContext(browser, origin, message => { if (failures.length < 50) failures.push(message); log(message); });
    if (signal.aborted) throw new Error('Validation cancelled');
    page = await context.newPage(); watchPage(page, log, failures);
    await page.goto(`${origin}/validation/grifball-validation.html`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__grifballValidation?.version === 1, undefined, { timeout: 30000 });
    const actualBuild = await page.evaluate(() => window.__grifballValidation!.buildId);
    if (actualBuild !== buildId) throw new Error('Validation page build identity mismatch');
    await page.evaluate(({ manifest, code, id }) => window.__grifballValidation!.prepare(manifest, code, id),
      { manifest: plan.manifest, code: plan.code, id: plan.id });
    if (failures.length) throw new Error(failures.join('; '));
    const running = page.evaluate(id => window.__grifballValidation!.runJob(id), job.id);
    // Capture the real canvas while simulation runs. Never delay the job's result on a screenshot.
    void page.waitForFunction(() => window.__grifballValidation?.progress()?.stage === 'running', undefined, { timeout: 15000 }).then(() => page!.screenshot({ path: join(directory, 'screenshots', `${name}-arena.png`), timeout: 5000 })).catch(() => {});
    const result = await running;
    if (result.jobId !== job.id || result.check.id !== job.id) throw new Error('Browser returned a result for another job');
    if (failures.length) return { ...result, termination: 'setup-error' as const, check: trialCheck(job.id, 'setup-error', failures.join('; ')) };
    return result;
  })();
  let result: TrialResult;
  try { result = await bounded(work, job.watchdogSeconds * 1000, signal); }
  catch (error) {
    log(String(error));
    result = failedTrial(job, signal.aborted ? 'cancelled' : error instanceof WatchdogError ? 'watchdog' : 'setup-error', String(error));
  }
  if (signal.aborted && page) {
    try {
      await bounded(page.evaluate(() => window.__grifballValidation?.cancel()), 1000);
      result = await bounded(work, 1000);
    } catch { /* The renderer may be blocked or crashed; keep the explicit cancellation. */ }
  }
  if (result.check.verdict === 'fail' && page) {
    try { await page.screenshot({ path: join(directory, 'screenshots', `${name}-failure.png`), timeout: 2000 }); }
    catch (error) { log(`Failure screenshot unavailable: ${String(error)}`); }
  }
  try { if (context) await bounded(context.close(), 5000); }
  catch (error) { log(`Context cleanup failed: ${String(error)}`); result = { ...result, termination: 'setup-error', check: trialCheck(job.id, 'setup-error', `Context cleanup failed: ${String(error)}`) }; }
  return result;
}

/** Normal production document, with no validation entry or automation hook. */
export async function productionStartup(browser: Browser, origin: string, directory: string, signal: AbortSignal) {
  const failures: string[] = [];
  const log = (message: string) => appendFileSync(join(directory, 'logs', 'production-startup.log'), message.slice(0, 4000) + '\n');
  const context = await isolatedContext(browser, origin, log);
  let page: Page | undefined;
  try {
    page = await context.newPage();
    // Account endpoints are intentionally unavailable in this offline smoke. Record them separately.
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/api/')) failures.push(`HTTP ${response.status()}: ${response.url()}`); });
    page.on('requestfailed', request => { if (new URL(request.url()).origin === origin && !new URL(request.url()).pathname.startsWith('/api/')) failures.push(`Resource failed: ${request.url()}`); });
    await bounded((async () => {
      await page.goto(origin, { waitUntil: 'load' });
      await page.getByRole('button', { name: 'Single Player', exact: true }).waitFor({ state: 'visible' });
      if (await page.evaluate(() => Boolean(window.__grifballValidation))) throw new Error('Validation hook leaked into production');
      await page.screenshot({ path: join(directory, 'screenshots', 'production-startup.png'), timeout: 10000 });
      if (failures.length) throw new Error(failures.join('; '));
    })(), 60000, signal);
  } catch (error) {
    log(String(error));
    if (page) await page.screenshot({ path: join(directory, 'screenshots', 'production-startup-failure.png'), timeout: 2000 }).catch(() => {});
    throw error;
  } finally { await bounded(context.close(), 5000); }
}

/** A deliberately small UI check alongside the API-driven trials. Uses only visible controls. */
export async function labControlsSmoke(browser: Browser, origin: string, directory: string, signal: AbortSignal) {
  const log = (message: string) => appendFileSync(join(directory, 'logs', 'lab-ui.log'), message.slice(0, 4000) + '\n');
  const context = await isolatedContext(browser, origin, log);
  let page: Page | undefined;
  try {
    await bounded((async () => {
      page = await context.newPage();
      await page.goto(origin, { waitUntil: 'load' });
      log(await page.locator('body').ariaSnapshot());
      const notice = page.getByRole('button', { name: 'Got it', exact: true });
      if (await notice.isVisible()) await notice.click();
      await page.getByRole('button', { name: 'Single Player', exact: true }).click();
      await page.getByRole('button', { name: 'AI Behavior Editor', exact: true }).click();
      await page.getByRole('button', { name: 'Grifball AI Lab · Team tactics and scenarios', exact: true }).click();
      const lab = page.getByRole('complementary', { name: 'Grifball AI Lab' });
      await lab.getByRole('tab', { name: 'Spacing', exact: true }).click();
      const toggle = lab.getByRole('checkbox', { name: /^Custom spacing/ });
      const original = await toggle.isChecked();
      await toggle.setChecked(!original);
      if (await toggle.isChecked() === original) throw new Error('Lab toggle did not change');
      await toggle.setChecked(original);
      await lab.getByRole('button', { name: 'Collapse lab' }).click();
      await lab.getByRole('button', { name: 'Expand lab' }).click();
      await page.screenshot({ path: join(directory, 'screenshots', 'lab-controls.png'), timeout: 10000 });
      await lab.getByRole('button', { name: 'Close lab' }).click();
      if (await lab.isVisible()) throw new Error('Lab did not close');
    })(), 60000, signal);
  } catch (error) {
    if (page) { log(await page.locator('body').ariaSnapshot().catch(() => 'Snapshot unavailable')); await page.screenshot({ path: join(directory, 'screenshots', 'lab-controls-failure.png'), timeout: 2000 }).catch(() => {}); }
    throw error;
  } finally { await bounded(context.close(), 5000); }
}
