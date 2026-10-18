import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Run the hook in React's browser renderer: server rendering does not run the
// effects that register identities, reset matches, and publish readiness.
test('multiplayer loading lifecycle preserves peers and requires the local scene', { timeout: 60_000 }, async t => {
  const fixture = await build({
    stdin: {
      resolveDir: resolve('.'),
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { useMatchLoadingGate } from './src/components/loading/useMatchLoadingGate';

        let root, options, gate;
        const sent = [];
        const socket = Object.assign(new EventTarget(), {
          readyState: WebSocket.OPEN, send: packet => sent.push(JSON.parse(packet)),
        });
        const defaults = {
          isPlaying: false, isMultiplayer: true, multiplayerRole: 'host', multiplayerSpawnSlot: 0,
          multiplayerSocket: socket, gameplayClientId: 'host', setGameplayClientId: () => {},
          playerName: 'Host', playerHue: 200, playerLoadout: {}, selectedMap: 'hangar',
          lobbyCustomMapData: null,
        };
        function Probe() { gate = useMatchLoadingGate(options); return null; }
        const render = () => flushSync(() => root.render(React.createElement(Probe)));
        window.loadingFixture = {
          mount: overrides => {
            root?.unmount(); sent.length = 0;
            options = { ...defaults, ...overrides };
            root = createRoot(document.getElementById('root')); render();
          },
          update: overrides => { options = { ...options, ...overrides }; render(); },
          call: (method, ...args) => flushSync(() => gate[method](...args)),
          receive: packet => socket.dispatchEvent(new MessageEvent('message', {
            data: typeof packet === 'string' ? packet : JSON.stringify(packet),
          })),
          snapshot: () => ({ active: gate.isMatchLoadingActive, local: gate.gameLoadingState,
            roster: gate.multiplayerLoadingSnapshot.participants,
            waiting: gate.multiplayerLoadingSnapshot.waitingCount, sent: [...sent] }),
        };
      `,
    },
    bundle: true,
    platform: 'browser',
    write: false,
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const source = fixture.outputFiles[0].text;
  const server = createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(source);
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  await page.waitForFunction(() => Boolean((window as any).loadingFixture));
  const snapshot = () => page.evaluate(() => (window as any).loadingFixture.snapshot());
  const call = (method: string, ...args: unknown[]) => page.evaluate(
    ({ method, args }) => (window as any).loadingFixture.call(method, ...args), { method, args });
  const mount = (overrides = {}) => page.evaluate(value => (window as any).loadingFixture.mount(value), overrides);
  const update = (overrides: Record<string, unknown>) => page.evaluate(value => (window as any).loadingFixture.update(value), overrides);
  const receive = (packet: unknown) => page.evaluate(value => (window as any).loadingFixture.receive(value), packet);
  const ready = { visible: false, progress: 100, stage: 'Ready', ready: true };

  await t.test('starting retains both waiting peers and readiness already received from a fast peer', async () => {
    await mount();
    await call('mergeLoadingParticipants', [
      { clientId: 'host', role: 'host' }, { clientId: 'fast', role: 'client' }, { clientId: 'slow', role: 'client' },
    ]);
    await call('upsertLoadingParticipantStatus', { clientId: 'fast', role: 'client', progress: 100, ready: true });
    await update({ isPlaying: true });
    await call('handleGameLoadingStateChange', ready);
    let state = await snapshot();
    assert.deepEqual(state.roster.map((entry: any) => entry.clientId).sort(), ['fast', 'host', 'slow']);
    assert.equal(state.roster.find((entry: any) => entry.clientId === 'fast').ready, true);
    assert.equal(state.active, true, 'the slow peer must still hold the gate');
    await call('upsertLoadingParticipantStatus', { clientId: 'slow', role: 'client', progress: 100, ready: true });
    state = await snapshot();
    assert.equal(state.active, false);
    assert.equal(state.sent.at(-1).ready, true);
  });

  await t.test('an incidental custom map update does not reset a premade arena', async () => {
    await mount({ isPlaying: true });
    await call('handleGameLoadingStateChange', ready);
    assert.equal((await snapshot()).active, false);
    await update({ lobbyCustomMapData: { id: 'unused', name: 'Unused custom map' } });
    const state = await snapshot();
    assert.equal(state.local.ready, true);
    assert.equal(state.active, false);
  });

  await t.test('an actual custom map change resets local readiness while retaining peers', async () => {
    await mount({ isPlaying: true, selectedMap: 'custom_file', lobbyCustomMapData: { id: 'first' } });
    await call('upsertLoadingParticipantStatus', { clientId: 'peer', role: 'client', progress: 100, ready: true });
    await call('handleGameLoadingStateChange', ready);
    await update({ lobbyCustomMapData: { id: 'second' } });
    const state = await snapshot();
    assert.equal(state.local.ready, false);
    assert.equal(state.active, true);
    assert.equal(state.roster.find((entry: any) => entry.clientId === 'peer').ready, true);
  });

  await t.test('peer and local status timeouts cannot release an unfinished local scene', async () => {
    await page.clock.install();
    await mount({ isPlaying: true });
    await call('upsertLoadingParticipantSlot', { clientId: 'peer', role: 'client' });
    await page.clock.fastForward(46_000);
    let state = await snapshot();
    assert.equal(state.active, true);
    assert.equal(state.local.ready, false);
    assert.equal(state.roster.find((entry: any) => entry.clientId === 'host').timedOut, false);
    assert.equal(state.waiting, 1);
    await call('handleGameLoadingStateChange', ready);
    state = await snapshot();
    assert.equal(state.active, false, 'a ready local scene may proceed once a silent peer times out');
  });

  await t.test('time spent in lobby does not consume a waiting peer loading deadline', async () => {
    await mount();
    await call('upsertLoadingParticipantSlot', { clientId: 'peer', role: 'client' });
    await page.clock.fastForward(60_000);
    await update({ isPlaying: true });
    await call('handleGameLoadingStateChange', ready);
    await page.clock.fastForward(1_000);
    const state = await snapshot();
    assert.equal(state.active, true);
    assert.equal(state.roster.find((entry: any) => entry.clientId === 'peer').timedOut, false);
  });

  await t.test('a scene failure never counts as local readiness', async () => {
    await mount({ isPlaying: true });
    await call('handleGameLoadingStateChange', { ...ready, error: 'Scene failed', stage: 'Load failed' });
    assert.equal((await snapshot()).active, true);
  });

  await t.test('ready players resend readiness once when a late participant starts loading', async () => {
    await mount({ isPlaying: true });
    await call('handleGameLoadingStateChange', ready);
    const initialCount = (await snapshot()).sent.length;
    const lateStatus = { type: 'sync', action: 'match_loading_status', senderId: 'late', senderRole: 'observer', ready: false };

    await receive(lateStatus);
    let state = await snapshot();
    assert.equal(state.sent.length, initialCount + 1);
    assert.equal(state.sent.at(-1).ready, true);
    await receive({ ...lateStatus, progress: 50, stage: 'Building arena' });
    await receive({ ...lateStatus, progress: 90, stage: 'Finalizing render targets' });
    assert.equal((await snapshot()).sent.length, initialCount + 1, 'loading progress must not cause a reply storm');

    await receive({ ...lateStatus, ready: true, progress: 100 });
    assert.equal((await snapshot()).sent.length, initialCount + 1, 'ready replies must not trigger more replies');
    await receive(lateStatus);
    assert.equal((await snapshot()).sent.length, initialCount + 2, 'a later loading attempt receives readiness again');

    await receive({ ...lateStatus, senderId: 'host' });
    await receive({ ...lateStatus, senderId: '' });
    await receive({ ...lateStatus, senderId: undefined });
    await receive({ ...lateStatus, type: 'other' });
    await receive('invalid-json');
    assert.equal((await snapshot()).sent.length, initialCount + 2);
  });

  await t.test('unfinished or failed local scenes do not answer readiness requests', async () => {
    await mount({ isPlaying: true });
    const lateStatus = { type: 'sync', action: 'match_loading_status', senderId: 'late', ready: false };
    let initialCount = (await snapshot()).sent.length;
    await receive(lateStatus);
    assert.equal((await snapshot()).sent.length, initialCount);
    await call('handleGameLoadingStateChange', { ...ready, error: 'Scene failed', stage: 'Load failed' });
    initialCount = (await snapshot()).sent.length;
    assert.equal((await snapshot()).sent.at(-1).ready, false);
    await receive(lateStatus);
    assert.equal((await snapshot()).sent.length, initialCount);
  });

  await t.test('disconnecting clears session participants', async () => {
    await mount();
    await call('upsertLoadingParticipantSlot', { clientId: 'peer', role: 'client' });
    await update({ multiplayerSocket: null });
    assert.deepEqual((await snapshot()).roster, []);
  });
  assert.deepEqual(errors, []);
});
