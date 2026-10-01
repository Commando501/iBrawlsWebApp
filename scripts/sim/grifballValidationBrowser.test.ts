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

test('state streaming flushes the final batch and fails closed on transfer errors or overflow', { timeout: 60000 }, async t => {
  const root = resolve('output/grifball-validation'); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'state-stream-'));
  mkdirSync(join(directory, 'logs')); mkdirSync(join(directory, 'screenshots'));
  const manifest = createSuiteManifest('quick'); manifest.cases = manifest.cases.slice(0, 1);
  manifest.cases[0].seeds = [101]; manifest.cases[0].mirrored = false;
  const plan = await createSuitePlan(manifest, { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src'] });
  const job = { ...plan.jobs[0], watchdogSeconds: 10 };
  const result = failedTrial(job, 'scenario-complete', 'Synthetic completed driver fixture');
  let count = 65;
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><h1>State transfer fixture</h1><script>
      window.__grifballValidation={version:1,buildId:'fixture',prepare:async()=>[],progress:()=>null,cancel:()=>{},
      observeState:observer=>{window.observer=observer},runJob:async()=>{
        for(let tick=0;tick<${count};tick++) window.observer(JSON.stringify({frame:{tick}}));
        return ${JSON.stringify(result)};
      }};</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    for (const mode of ['complete', 'rejected', 'overflow']) await t.test(mode, async () => {
      count = mode === 'overflow' ? 3900 : 65;
      const batches: string[][] = [];
      const actual = await runBrowserJob(browser, origin, 'fixture', plan, job, directory, new AbortController().signal, states => {
        if (mode === 'rejected') throw new Error('Injected state transfer rejection');
        batches.push(states);
      });
      if (mode === 'complete') {
        assert.equal(actual.check.verdict, 'pass');
        assert.deepEqual(batches.map(batch => batch.length), [60, 5]);
        assert.deepEqual(batches.flat().map(state => JSON.parse(state).frame.tick), Array.from({ length: 65 }, (_, i) => i));
      } else {
        assert.equal(actual.check.verdict, 'fail');
        assert.match(actual.check.summary, mode === 'rejected' ? /transfer rejection/ : /bounded transfer backlog/);
      }
    });
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

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
