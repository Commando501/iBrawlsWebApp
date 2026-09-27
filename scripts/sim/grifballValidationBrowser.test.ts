// Explicit integration command: uses the repository-pinned browser, never a personal browser profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import { bounded, failedTrial, runBrowserJob } from './grifballValidationBrowser';

test('driver retains injected invalid-state, missing-asset, blocked-renderer and browser-crash failures', { timeout: 60000 }, async t => {
  const root = resolve('output/grifball-validation'); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'driver-faults-'));
  mkdirSync(join(directory, 'logs')); mkdirSync(join(directory, 'screenshots'));
  const manifest = createSuiteManifest('quick'); manifest.cases = manifest.cases.slice(0, 1);
  manifest.cases[0].seeds = [101]; manifest.cases[0].mirrored = false;
  const plan = await createSuitePlan(manifest, { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src'] });
  let fault = 'invalid-state';
  let started: (() => void) | undefined;
  const job = { ...plan.jobs[0], watchdogSeconds: 2 };
  const result = failedTrial(job, 'invalid-state', 'Injected invalid health');
  const server = createServer((req, res) => {
    if (req.url === '/ready') { started?.(); res.end('ready'); return; }
    if (req.url?.includes('missing.js')) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><h1>Driver fault fixture</h1>${fault === 'missing-asset' ? '<script src="/missing.js"></script>' : ''}<script>window.__grifballValidation={version:1,buildId:'fixture',prepare:async()=>[],progress:()=>null,cancel:()=>{},runJob:async()=>{${fault === 'blocked-renderer' ? 'while(true){}' : fault === 'browser-crash' ? "await fetch('/ready'); return new Promise(()=>{});" : `return ${JSON.stringify(result)};`}}};</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const mode of ['invalid-state', 'missing-asset', 'blocked-renderer', 'browser-crash']) await t.test(mode, async () => {
      fault = mode;
      const owned = await chromium.launchServer({ channel: 'chromium', headless: true });
      try {
        const browser = await chromium.connect(owned.wsEndpoint());
        const ready = new Promise<void>(resolve => { started = resolve; });
        const running = runBrowserJob(browser, origin, 'fixture', plan, job, directory, new AbortController().signal);
        if (mode === 'browser-crash') {
          await bounded(ready, 5000);
          const cdp = await browser.newBrowserCDPSession(); await cdp.send('Browser.crash').catch(() => {});
        }
        const actual = await bounded(running, 15000);
        assert.equal(actual.check.verdict, 'fail');
        assert.equal(actual.termination, mode === 'invalid-state' ? 'invalid-state' : mode === 'blocked-renderer' ? 'watchdog' : 'setup-error');
      } finally { await bounded(owned.kill(), 5000); }
    });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  console.log(`Fault evidence: ${directory}`);
});
