import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIMatchContext, resetAIMatchContext, startWeaponSwapFeint, tickWeaponSwapFeintTimer,
  isWeaponSwapFeintActive } from './aiMatchContext';
import { createBotComboState } from './aiComboEngine';
import { createBotPsychState } from './aiPsychologicalPressure';
import { createPlayerModel } from './aiPlayerModel';

test('resetAIMatchContext clears per-match stores', () => {
  const context = createAIMatchContext();
  context.playerModels.set('player', createPlayerModel());
  context.feintCooldowns.set('main_ai', 2.5);
  context.weaponSwapFeintTimers.set('bot_1', 0.4);
  context.comboState.set('bot_1', createBotComboState('mixup', 'player'));
  context.psychState.set('main_ai', createBotPsychState());
  context.skillCalibration.set('main_ai', { snapshots: [] });

  resetAIMatchContext(context);

  assert.equal(context.playerModels.size, 0);
  assert.equal(context.feintCooldowns.size, 0);
  assert.equal(context.weaponSwapFeintTimers.size, 0);
  assert.equal(context.comboState.size, 0);
  assert.equal(context.psychState.size, 0);
  assert.equal(context.skillCalibration.size, 0);
  context.coordinator.priorityTargetId = 'player';
  resetAIMatchContext(context);
  assert.equal(context.coordinator.priorityTargetId, undefined);
});

test('expired weapon feints remain pending through committed strikes and revert exactly once', () => {
  const context = createAIMatchContext(), dt = 1 / 60;
  startWeaponSwapFeint(context, 'bot', dt * 1.5);
  assert.equal(tickWeaponSwapFeintTimer(context, 'bot', dt, false), false);
  assert.ok(context.weaponSwapFeintTimers.get('bot')! < dt);
  for (let tick = 0; tick < 20; tick++) {
    assert.equal(tickWeaponSwapFeintTimer(context, 'bot', dt, false), false);
    assert.equal(isWeaponSwapFeintActive(context, 'bot'), true);
  }
  const restored = createAIMatchContext();
  restored.weaponSwapFeintTimers = new Map(JSON.parse(JSON.stringify([...context.weaponSwapFeintTimers])));
  for (const memory of [context, restored]) {
    assert.equal(tickWeaponSwapFeintTimer(memory, 'bot', dt, true), true);
    assert.equal(isWeaponSwapFeintActive(memory, 'bot'), false);
    assert.equal(tickWeaponSwapFeintTimer(memory, 'bot', dt, true), false);
  }
  startWeaponSwapFeint(context, 'bot', dt / 2);
  tickWeaponSwapFeintTimer(context, 'bot', dt, false);
  resetAIMatchContext(context);
  assert.equal(tickWeaponSwapFeintTimer(context, 'bot', dt), false, 'match reset cancels pending reverts');
});

test('unblocked weapon feints retain the original countdown', () => {
  const context = createAIMatchContext(), dt = 1 / 60;
  startWeaponSwapFeint(context, 'bot', dt * 1.5);
  assert.equal(tickWeaponSwapFeintTimer(context, 'bot', dt), false);
  assert.equal(tickWeaponSwapFeintTimer(context, 'bot', dt), true);
  assert.equal(tickWeaponSwapFeintTimer(context, 'bot', dt), false);
});
