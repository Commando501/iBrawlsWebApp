import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NEURAL_BRAIN_ID,
  NEURAL_BRAIN_DEFINITIONS,
  NEURAL_NET_DIFFICULTY,
  getNeuralBrainDefinition,
  isNeuralNetDifficulty,
} from './neuralBrains';
import { ACTION_NVEC } from '../sim/env/action';
import { OBS_DIM_V1, OBS_DIM_V3 } from '../sim/env/observation';

test('CombatDRV2 browser brain definition pins the trained contract', () => {
  const brain = getNeuralBrainDefinition(DEFAULT_NEURAL_BRAIN_ID);

  assert.equal(brain.id, 'combat_dr_v2');
  assert.equal(brain.label, 'CombatDRV2');
  assert.equal(brain.mode, 'combat');
  assert.equal(brain.observationVersion, 1);
  assert.equal(brain.baseObservationDim, OBS_DIM_V1);
  assert.equal(brain.frameStack, 4);
  assert.equal(brain.inputDim, OBS_DIM_V1 * 4);
  assert.deepEqual(brain.actionNvec, ACTION_NVEC);
  assert.equal(brain.decisionInterval, 5);
  assert.match(brain.manifestUrl, /\/brains\/combat_dr_v2\/manifest\.json$/);
  assert.ok(NEURAL_BRAIN_DEFINITIONS.length >= 1);
});

test('CombatDRV4 browser brain definition is selectable with the trained contract', () => {
  const brain = getNeuralBrainDefinition('combat_dr_v4');

  assert.equal(brain.id, 'combat_dr_v4');
  assert.equal(brain.label, 'CombatDRV4');
  assert.equal(brain.mode, 'combat');
  assert.equal(brain.observationVersion, 1);
  assert.equal(brain.baseObservationDim, OBS_DIM_V1);
  assert.equal(brain.frameStack, 4);
  assert.equal(brain.inputDim, OBS_DIM_V1 * 4);
  assert.deepEqual(brain.actionNvec, ACTION_NVEC);
  assert.equal(brain.decisionInterval, 5);
  assert.match(brain.manifestUrl, /\/brains\/combat_dr_v4\/manifest\.json$/);
});

test('CombatUpgradeV3 browser brain definition is selectable with the trained contract', () => {
  const brain = getNeuralBrainDefinition('combat_upgrade_v3');

  assert.equal(brain.id, 'combat_upgrade_v3');
  assert.equal(brain.label, 'CombatUpgradeV3');
  assert.equal(brain.mode, 'combat');
  assert.equal(brain.observationVersion, 3);
  assert.equal(brain.baseObservationDim, OBS_DIM_V3);
  assert.equal(brain.frameStack, 4);
  assert.equal(brain.inputDim, OBS_DIM_V3 * 4);
  assert.deepEqual(brain.actionNvec, ACTION_NVEC);
  assert.equal(brain.decisionInterval, 5);
  assert.match(brain.manifestUrl, /\/brains\/combat_upgrade_v3\/manifest\.json$/);
});

test('NeuralNet difficulty discriminator stays explicit', () => {
  assert.equal(NEURAL_NET_DIFFICULTY, 'neural-net');
  assert.equal(isNeuralNetDifficulty('neural-net'), true);
  assert.equal(isNeuralNetDifficulty('nightmare'), false);
});
