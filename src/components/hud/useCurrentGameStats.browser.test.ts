import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('frame snapshots update HUD and replay consumers without rerendering the app or scene', { timeout: 60_000 }, async t => {
  const fixture = await build({
    stdin: { resolveDir: resolve('.'), contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { useCurrentGameStats, GameStatsView } from './src/components/hud/useCurrentGameStats';
      let stats, ping = 0, mounted = true;
      const counts = { app: 0, scene: 0, hud: 0, replay: 0 };
      function Scene() { counts.scene++; return null; }
      function App() {
        counts.app++;
        stats = useCurrentGameStats({ getSavedPlayerHue: () => 90, ping });
        return React.createElement(React.Fragment, null,
          React.createElement(Scene),
          mounted && React.createElement(GameStatsView, { store: stats.statsStore }, s => {
            counts.hud++; return React.createElement('output', { id: 'hud' }, s.playerHP + ':' + s.ping);
          }),
          mounted && React.createElement(GameStatsView, { store: stats.statsStore }, s => {
            counts.replay++; return React.createElement('output', { id: 'replay' }, s.replayElapsedTime);
          }));
      }
      const root = createRoot(document.getElementById('root'));
      const render = () => flushSync(() => root.render(React.createElement(App)));
      render();
      window.fixture = {
        update: value => flushSync(() => stats.setCurrentStats(s => ({ ...s, ...value }))),
        ping: value => { ping = value; render(); },
        mount: value => { mounted = value; render(); },
        counts: () => ({ ...counts }),
      };
    ` }, bundle: true, platform: 'browser', write: false,
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const server = createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(fixture.outputFiles[0].text);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
    }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  await page.waitForFunction(() => Boolean((window as any).fixture));
  const before = await page.evaluate(() => (window as any).fixture.counts());
  await page.evaluate(() => {
    for (let i = 0; i < 120; i++) (window as any).fixture.update({ playerHP: i, replayElapsedTime: i / 60 });
  });
  const after = await page.evaluate(() => (window as any).fixture.counts());
  assert.equal(after.app, before.app);
  assert.equal(after.scene, before.scene);
  assert.equal(after.hud - before.hud, 120);
  assert.equal(after.replay - before.replay, 120);
  assert.equal(await page.locator('#hud').textContent(), '119:0');
  assert.equal(await page.locator('#replay').textContent(), String(119 / 60));
  await page.evaluate(() => (window as any).fixture.ping(42));
  await page.waitForFunction(() => document.querySelector('#hud')?.textContent === '119:42');
  await page.evaluate(() => {
    (window as any).fixture.mount(false);
    (window as any).fixture.update({ playerHP: 7 });
    (window as any).fixture.mount(true);
  });
  assert.equal(await page.locator('#hud').textContent(), '7:42');
  assert.deepEqual(errors, []);
});
