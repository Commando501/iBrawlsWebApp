import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIMatchContext, resetAIMatchContext } from './aiMatchContext';
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
