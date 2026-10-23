import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DEFAULT_MAP_SCALE, getStadiumMapScale, normalizeMapScalePercent, sanitizeMapScaleSetting } from '../../shared/mapBalanceSettings';
import { BALANCEABLE_MAPS, balanceMap, createBalancedMapSnapshot, createPublishedMapSnapshot, getMapTraversal } from './mapBalancing';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { getGoalPlates, findScoringPlate } from './grifballGoals';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import { createInitialGrifballRuntimeState } from '../components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../components/grifball/threeRefs';
import { updatePlayerHorizontalMovementForState } from '../components/grifball/playerMovementRuntime';
import { DEFAULT_KEYBINDINGS } from '../types';
import { pickLiveConfigSettings } from '../settings/liveConfigKeys';

const base = BALANCEABLE_MAPS[0];
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('published map pins geometry and its version together, including default and missing presets', () => {
  const preset = { version: 42, settings: { mapScaleStadiumLength: 125, mapScaleStadiumWidth: 75, mapScaleStadiumHeight: 60 } };
  const session = createPublishedMapSnapshot(base.id, preset)!;
  assert.equal(session.balancePresetVersion, 42);
  assert.deepEqual(session.balanceScale, { length: 125, width: 75, height: 60 });
  preset.version = 43;
  preset.settings.mapScaleStadiumLength = 150;
  assert.equal(session.balancePresetVersion, 42);
  assert.equal(session.balanceScale!.length, 125);
  assert.equal(createPublishedMapSnapshot(base.id, preset)!.balancePresetVersion, 43);
  assert.equal(createPublishedMapSnapshot(base.id, { version: 44, settings: {} })!.balancePresetVersion, 44);
  const fallback = createPublishedMapSnapshot(base.id, null)!;
  assert.deepEqual(fallback.balanceScale, DEFAULT_MAP_SCALE);
  assert.equal(fallback.balancePresetVersion, null);
  assert.equal(createPublishedMapSnapshot('custom_file', preset), null);
  assert.equal(createPublishedMapSnapshot('hangar', preset), null);
});

test('scale values are bounded and invalid network/storage input cannot corrupt geometry', () => {
  for (const value of [undefined, null, '125', NaN, Infinity, {}, []]) assert.equal(normalizeMapScalePercent(value), 100);
  assert.equal(normalizeMapScalePercent(-10), 50);
  assert.equal(normalizeMapScalePercent(800), 200);
  assert.equal(normalizeMapScalePercent(124.6), 125);
  assert.deepEqual(getStadiumMapScale({}), DEFAULT_MAP_SCALE);
  assert.equal(sanitizeMapScaleSetting('mapScaleStadiumLength', -1), 50);
  assert.equal(sanitizeMapScaleSetting('speedForward', 140), 140);
  assert.deepEqual(pickLiveConfigSettings({ mapScaleStadiumWidth: Infinity, mapScaleStadiumHeight: 500, mapScaleStadiumLength: 125 }), {
    mapScaleStadiumWidth: 100, mapScaleStadiumHeight: 200, mapScaleStadiumLength: 125,
  });
});

test('independent scaling preserves spawn and goal clearance across every supported extreme', () => {
  const original = JSON.stringify(base);
  for (const length of [50, 100, 200]) for (const width of [50, 100, 200]) for (const height of [50, 100, 200]) {
    const scaled = balanceMap(base, { length, width, height });
    const half = scaled.arenaHalfExtents!;
    near(half.x, base.arenaHalfExtents!.x * length / 100);
    near(half.z, base.arenaHalfExtents!.z * width / 100);
    assert.equal(scaled.arenaCeiling, undefined, 'open sky stays open');
    for (const spawn of [...scaled.spawnPoints, ...Object.values(scaled.teamSpawns!).flat()]) {
      const pos = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
      const before = pos.clone();
      constrainCombatantToArenaBounds({ pos, vel: new THREE.Vector3(), activeCustomMap: scaled, arenaRadius: scaled.arenaRadius });
      assert.ok(pos.distanceTo(before) < 1e-8, 'a spawn must already be inside the player bounds');
    }
    const plates = getGoalPlates(scaled);
    for (const plate of plates) {
      assert.ok(Math.abs(plate.position.x) + plate.halfExtents.x < half.x - .6);
      assert.ok(plate.halfExtents.z < half.z - .6);
      assert.equal(findScoringPlate(plate.position.x, plate.position.z, plate.team === 'red' ? 'blue' : 'red', plates), plate);
    }
    scaled.objects.forEach((object, index) => {
      assert.deepEqual(object.rotation, { x: 0, y: 0, z: 0 }, 'eligible authored geometry must stay axis-aligned');
      near(object.position.y - object.scale.y / 2, 0);
      near(object.scale.x, base.objects[index].scale.x * length / 100);
      near(object.scale.z, base.objects[index].scale.z * width / 100);
    });
    near(scaled.lighting.directPosition.y, base.lighting.directPosition.y * height / 100);
  }
  assert.equal(JSON.stringify(base), original, 'authored maps are immutable');
  assert.deepEqual(balanceMap(base, DEFAULT_MAP_SCALE).objects, base.objects);
});

test('map snapshots are idempotent, isolated and restricted to the supported authored court', () => {
  const map = createBalancedMapSnapshot(base.id, { mapScaleStadiumLength: 150, mapScaleStadiumHeight: 50 })!;
  assert.equal(balanceMap(map, { length: 200, width: 200, height: 200 }), map);
  assert.equal(createBalancedMapSnapshot('custom_file', {}), null);
  assert.equal(createBalancedMapSnapshot('hangar', {}), null);
  const nextLobby = createBalancedMapSnapshot(base.id, {})!;
  assert.notEqual(map, nextLobby);
  near(map.arenaHalfExtents!.x, 92.25);
  near(nextLobby.arenaHalfExtents!.x, 61.5);
});

test('traversal agrees with live player velocity for forward running and sprint on both axes', () => {
  for (const speedForward of [0, 50, 100, 165]) for (const speedSprint of [100, 140, 200]) for (const enableSprint of [false, true]) {
    const settings = { ...DEFAULT_ADMIN_SETTINGS, speedForward, speedSprint, enableSprint, gameMode: 'grifball' as const };
    const map = balanceMap(base, { length: 75, width: 150, height: 60 });
    const traversal = getMapTraversal(map, settings);
    for (const sprintHeld of [false, true]) for (const yaw of [0, Math.PI / 2]) {
      const state = createInitialGrifballRuntimeState({ adminSettings: settings, debugMode: false, isMultiplayer: false, multiplayerRole: null });
      state.yaw = yaw;
      updatePlayerHorizontalMovementForState({ state, refs: createInitialGrifballThreeRefs(), dt: 1 / 60,
        keysPressed: { [DEFAULT_KEYBINDINGS.moveForward]: true, [DEFAULT_KEYBINDINGS.sprint]: sprintHeld },
        movementKeybindings: DEFAULT_KEYBINDINGS, actionKeybindings: DEFAULT_KEYBINDINGS, gamepad: null,
        mobileJoystick: null, mobileControlsActive: false, sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false },
      });
      near(state.playerVel.length(), sprintHeld && enableSprint ? traversal.sprint! : traversal.run);
    }
    near(traversal.lengthRun! * traversal.run, map.arenaHalfExtents!.x * 2 - 1.2);
    near(traversal.widthRun! * traversal.run, map.arenaHalfExtents!.z * 2 - 1.2);
    if (!enableSprint) assert.equal(traversal.lengthSprint, null);
  }
  const standard = getMapTraversal(base, { ...DEFAULT_ADMIN_SETTINGS, enableSprint: true });
  near(standard.lengthSprint!, 15);
  near(standard.widthSprint!, 8);
  assert.equal(getMapTraversal(base, { ...DEFAULT_ADMIN_SETTINGS, enableSprint: true, speedSprint: 0 }).lengthSprint, null);
});
