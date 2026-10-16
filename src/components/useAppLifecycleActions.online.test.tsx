import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sfx } from './AudioEngine';
import { useAppLifecycleActions } from './useAppLifecycleActions';

function setup(t: TestContext, validEndpoint = true) {
  for (const method of ['init', 'resume', 'playRespawn'] as const) t.mock.method(sfx, method, () => {});
  const calls: [string, unknown][] = [];
  const options = {
    multiplayerSocket: null, singlePlayerMode: 'sandbox',
    cancelHostOrJoin: () => calls.push(['cancelPending', true]),
    closeMenuSocket: () => calls.push(['closePresence', true]),
    closeGamePanels: () => {}, applyMatchmakerUrl: () => validEndpoint, resetMatchmakerUrl: () => true,
  } as unknown as Parameters<typeof useAppLifecycleActions>[0];
  for (const key of ['IsPlaying','IsPaused','IsTerminated','IsMultiplayer','MultiplayerRole','MultiplayerSocket','ConnectionStatus','QuickPlayStatus','MultiplayerPlayerCount','MultiplayerSpawnSlot','OpponentClientId']) {
    (options as unknown as Record<string, unknown>)[`set${key}`] = (value: unknown) => calls.push([key,value]);
  }
  let actions!: ReturnType<typeof useAppLifecycleActions>;
  function Probe() { actions = useAppLifecycleActions(options); return null; }
  renderToStaticMarkup(<Probe/>);
  return { actions, calls };
}

test('starting local play cancels a pending online request before entering the game', t => {
  const { actions, calls } = setup(t);
  actions.handleStartGame();
  const cancelled = calls.findIndex(([key]) => key === 'cancelPending');
  assert.ok(cancelled >= 0);
  assert.ok(cancelled < calls.findIndex(([key,value]) => key === 'IsPlaying' && value === true));
  assert.ok(calls.some(([key,value]) => key === 'QuickPlayStatus' && value === 'idle'));
});

test('return to menu cancels pending connections even without an acknowledged multiplayer socket', t => {
  const { actions, calls } = setup(t);
  actions.handleReturnToMain();
  assert.deepEqual(calls[0], ['cancelPending',true]);
  assert.ok(calls.some(([key,value]) => key === 'ConnectionStatus' && value === 'idle'));
});

test('successful endpoint changes close the old session, invalid input leaves it intact', t => {
  const valid = setup(t);
  valid.actions.handleApplyMatchmakerUrl();
  assert.deepEqual(valid.calls.filter(([key]) => key === 'cancelPending' || key === 'closePresence').map(([key]) => key), ['cancelPending','closePresence']);
  const invalid = setup(t,false);
  invalid.actions.handleApplyMatchmakerUrl();
  assert.equal(invalid.calls.length,0);
});
