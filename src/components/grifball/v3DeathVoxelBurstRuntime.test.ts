import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildVoxelSpartanModel } from '../VoxelModels';
import { buildV3HammerModel, buildV3SpartanModel } from '../v3/VoxelModelsV3';
import { createInitialGrifballThreeRefs } from './threeRefs';
import {
  clearAllV3DeathVoxelBursts,
  clearV3DeathVoxelBurstForCombatant,
  syncV3DeathVoxelBurstForCombatant,
} from './v3DeathVoxelBurstRuntime';

const createRefs = () => {
  const refs = createInitialGrifballThreeRefs();
  refs.scene = new THREE.Scene();
  return refs;
};

test('V3 death burst runtime triggers once on alive-to-dead transition and clears on respawn', () => {
  const refs = createRefs();
  const model = buildV3SpartanModel({ customHue: 180 });
  const hammer = buildV3HammerModel(180);
  refs.scene!.add(model);

  syncV3DeathVoxelBurstForCombatant({
    refs,
    id: 'combatant:v3',
    model,
    weapons: [hammer],
    alive: true,
  });
  assert.equal(refs.v3DeathVoxelBursts.size, 0);

  const firstActive = syncV3DeathVoxelBurstForCombatant({
    refs,
    id: 'combatant:v3',
    model,
    weapons: [hammer],
    alive: false,
    dt: 0,
    qualityTier: 'mobileLow',
  });
  const firstInstance = refs.v3DeathVoxelBursts.get('combatant:v3');

  assert.equal(firstActive, true);
  assert.ok(firstInstance);
  assert.equal(firstInstance.mesh.count <= 48, true);
  assert.equal(model.visible, false);
  assert.equal(hammer.visible, false);

  syncV3DeathVoxelBurstForCombatant({
    refs,
    id: 'combatant:v3',
    model,
    weapons: [hammer],
    alive: false,
    dt: 0.01,
    qualityTier: 'mobileLow',
  });
  assert.equal(refs.v3DeathVoxelBursts.get('combatant:v3'), firstInstance);

  syncV3DeathVoxelBurstForCombatant({
    refs,
    id: 'combatant:v3',
    model,
    weapons: [hammer],
    alive: true,
  });
  assert.equal(refs.v3DeathVoxelBursts.has('combatant:v3'), false);
  assert.equal(firstInstance.disposed, true);
  assert.equal(model.userData.v3DeathBurstActive, false);
});

test('V3 death burst runtime leaves V1/V2 models unchanged', () => {
  const refs = createRefs();
  const model = buildVoxelSpartanModel();
  refs.scene!.add(model);

  syncV3DeathVoxelBurstForCombatant({
    refs,
    id: 'combatant:v1',
    model,
    alive: true,
  });
  const active = syncV3DeathVoxelBurstForCombatant({
    refs,
    id: 'combatant:v1',
    model,
    alive: false,
  });

  assert.equal(active, false);
  assert.equal(refs.v3DeathVoxelBursts.size, 0);
  assert.equal(model.visible, true);
});

test('V3 death burst runtime disposes completed bursts deterministically', () => {
  const refs = createRefs();
  const model = buildV3SpartanModel({ customHue: 220 });
  refs.scene!.add(model);

  syncV3DeathVoxelBurstForCombatant({ refs, id: 'combatant:v3', model, alive: true });
  syncV3DeathVoxelBurstForCombatant({
    refs,
    id: 'combatant:v3',
    model,
    alive: false,
    dt: 2,
    qualityTier: 'desktop',
  });

  assert.equal(refs.v3DeathVoxelBursts.has('combatant:v3'), false);
  clearAllV3DeathVoxelBursts(refs);
  assert.equal(refs.v3DeathVoxelBursts.size, 0);
  assert.equal(refs.v3DeathAliveState.size, 0);
});

test('V3 death burst runtime clears a single combatant burst and transition state for rebuilds', () => {
  const refs = createRefs();
  const model = buildV3SpartanModel({ customHue: 260 });
  refs.scene!.add(model);

  syncV3DeathVoxelBurstForCombatant({ refs, id: 'combatant:rebuild', model, alive: true });
  syncV3DeathVoxelBurstForCombatant({
    refs,
    id: 'combatant:rebuild',
    model,
    alive: false,
    qualityTier: 'mobileLow',
  });
  const instance = refs.v3DeathVoxelBursts.get('combatant:rebuild');
  assert.ok(instance);
  assert.equal(refs.v3DeathAliveState.get('combatant:rebuild'), false);

  clearV3DeathVoxelBurstForCombatant(refs, 'combatant:rebuild');

  assert.equal(instance.disposed, true);
  assert.equal(refs.v3DeathVoxelBursts.has('combatant:rebuild'), false);
  assert.equal(refs.v3DeathAliveState.has('combatant:rebuild'), false);
});
