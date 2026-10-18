import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_KEYBINDINGS } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../components/grifball/playerMovementRuntime';
import { createInitialGrifballRuntimeState } from '../components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../components/grifball/threeRefs';
import { PREMADE_MAPS } from './premadeMaps';
import { toGrifballArena } from './grifballMaps';
import { buildGrifballSpaceGeometry, createSpaceRouterFactory, isSpacePointOpen } from './grifballSpaceGeometry';
import { CHAMPIONSHIP_STADIUM_SPRINT_BASELINE, getChampionshipStadiumLayout, withChampionshipStadiumLayout } from './championshipStadiumLayout';

const stadium = PREMADE_MAPS.find(map => map.id === 'championship_stadium')!;

function traverse(axis: 'x' | 'z', sign: -1 | 1, hz: number, settings = { ...DEFAULT_ADMIN_SETTINGS, enableSprint: true }) {
  const state = createInitialGrifballRuntimeState({ adminSettings: settings, debugMode: false, isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs();
  const constrain = () => constrainCombatantToArenaBounds({ pos: state.playerPos, vel: state.playerVel, activeCustomMap: stadium, arenaRadius: stadium.arenaRadius });
  state.arenaRadius = stadium.arenaRadius;
  state.playerPos.set(0, 0, 0);
  state.playerPos[axis] = -sign * 1000;
  constrain();
  const start = state.playerPos[axis];
  const target = -start;
  state.yaw = axis === 'x' ? -sign * Math.PI / 2 : sign === 1 ? Math.PI : 0;
  const sprintToggleActiveRef = { current: false }, prevSprintInputRef = { current: false };
  const dt = 1 / hz;
  for (let frame = 1; frame <= hz * 30; frame++) {
    updatePlayerHorizontalMovementForState({ state, refs, dt,
      keysPressed: { [DEFAULT_KEYBINDINGS.moveForward]: true, [DEFAULT_KEYBINDINGS.sprint]: true },
      movementKeybindings: DEFAULT_KEYBINDINGS, actionKeybindings: DEFAULT_KEYBINDINGS,
      gamepad: null, mobileJoystick: null, mobileControlsActive: false,
      sprintToggleActiveRef, prevSprintInputRef,
    });
    updatePlayerVerticalIntegrationForState({ state, dt, gravityAcceleration: 20, constrainCombatantToArena: constrain });
    if (Math.abs(state.playerPos[axis] - target) < 1e-8) {
      return { seconds: frame * dt, travel: Math.abs(target - start), gait: state.playerIsSprinting };
    }
  }
  assert.fail(`Player never reached the opposite ${axis} boundary`);
}

for (const hz of [30, 60, 144]) {
  test(`Stadium reaches both opposing walls in 8s / 15s through actual sprint movement at ${hz}Hz`, () => {
    for (const sign of [-1, 1] as const) {
      for (const [axis, seconds] of [['x', 15], ['z', 8]] as const) {
        const result = traverse(axis, sign, hz);
        assert.ok(Math.abs(result.seconds - seconds) < 1e-8, `${axis}: ${result.seconds}s`);
        assert.ok(Math.abs(result.travel - seconds * CHAMPIONSHIP_STADIUM_SPRINT_BASELINE.sprintMetersPerSecond) < 1e-8);
        assert.equal(result.gait, true);
      }
    }
  });
}

test('authored sprint calibration matches the default speed percentages without enabling sprint globally', () => {
  assert.equal(DEFAULT_ADMIN_SETTINGS.enableSprint, false);
  assert.equal(DEFAULT_ADMIN_SETTINGS.speedForward, CHAMPIONSHIP_STADIUM_SPRINT_BASELINE.forwardPercent);
  assert.equal(DEFAULT_ADMIN_SETTINGS.speedSprint, CHAMPIONSHIP_STADIUM_SPRINT_BASELINE.sprintPercent);
  const result = traverse('x', 1, 60, { ...DEFAULT_ADMIN_SETTINGS });
  assert.equal(result.gait, false);
  assert.ok(Math.abs(result.seconds - 21) < 1e-8);
});

test('custom lobby speed changes travel time without resizing the authored map', () => {
  const before = JSON.stringify(stadium);
  const result = traverse('z', 1, 60, { ...DEFAULT_ADMIN_SETTINGS, enableSprint: true, speedForward: 200 });
  assert.equal(result.seconds, 4);
  assert.equal(JSON.stringify(stadium), before);
});

test('goals, end lights, and mirrored spawn lanes follow the enlarged court with 5m margins', () => {
  assert.deepEqual(stadium.arenaHalfExtents, { x: 61.5, z: 33.08 });
  assert.equal(toGrifballArena(stadium), stadium, 'Grifball conversion must preserve the authored Stadium size');
  assert.equal(stadium.arenaRadius, 61.5);
  assert.equal(stadium.fogDensity, 0.009);
  assert.equal(stadium.spawnPoints.length, 8);
  for (const [team, sign] of [['blue', -1], ['red', 1]] as const) {
    const spawns = stadium.teamSpawns![team];
    assert.deepEqual(spawns.map(spawn => spawn.x), Array(4).fill(sign * 56.5));
    assert.deepEqual(spawns.map(spawn => spawn.z), [-28.08, -14.04, 14.04, 28.08]);
    assert.equal(stadium.objects.find(object => object.id === `grifball_goal_${team}`)!.position.x, sign * 56.5);
    assert.equal(stadium.lighting.pointLights.find(light => light.id.includes(team))!.position.x, sign * 56.5);
  }
  assert.deepEqual(stadium.spawnPoints, [...stadium.teamSpawns!.blue, ...stadium.teamSpawns!.red]);
});

test('legacy restoration reproduces original arena, goals, spawns and lights without mutating the new preset', () => {
  const before = JSON.stringify(stadium);
  const old = withChampionshipStadiumLayout(stadium, 1);
  assert.deepEqual(old.arenaHalfExtents, { x: 52, z: 23 });
  assert.equal(old.arenaRadius, 52);
  assert.equal(old.fogDensity, 0.015);
  assert.deepEqual(old.teamSpawns!.blue.map(spawn => [spawn.x, spawn.z]), [[-47, -18], [-47, -9], [-47, 9], [-47, 18]]);
  assert.deepEqual(old.objects.map(object => object.position.x), [-47, 47]);
  assert.deepEqual(old.lighting.pointLights.map(light => light.position.x), [-47, 47]);
  assert.equal(JSON.stringify(stadium), before);
  old.arenaHalfExtents!.x = 1;
  assert.deepEqual(getChampionshipStadiumLayout(1).halfExtents, { x: 52, z: 23 });
});

test('AI navigation reaches the expanded wings and each opposing goal from every spawn', () => {
  const geometry = buildGrifballSpaceGeometry(stadium, stadium.arenaRadius);
  const routeFrom = createSpaceRouterFactory(geometry);
  const wings = [{ x: 0, z: -32 }, { x: 0, z: 32 }];
  for (const spawn of stadium.spawnPoints) {
    const goal = { x: spawn.x < 0 ? 56.5 : -56.5, z: 0 };
    for (const destination of [goal, ...wings]) {
      assert.equal(isSpacePointOpen(geometry, destination), true);
      const route = routeFrom(spawn)(destination);
      assert.equal(route.status, 'direct');
      assert.deepEqual(route.points.at(-1), destination);
    }
  }
  assert.equal(isSpacePointOpen(geometry, { x: 61, z: 0 }), false);
  assert.equal(isSpacePointOpen(geometry, { x: 0, z: 33 }), false);
});
