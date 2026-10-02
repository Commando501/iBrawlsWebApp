import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch, defaultGrifballMap } from './factory';
import { finishSimMixedArenaFrame } from './mixedArenaFrame';
import { createInitialGrifballRuntimeState } from '../components/grifball/runtimeState';
import { createOfflineBotCombatant } from '../game/roster';
import { resolvePlayerCombatantCollisionsForState } from '../components/grifball/playerCollisionSync';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import { stepSimulation } from './step';
import type { SimCombatPriorityMemory } from './grifballCombatPriorities';

for (const observer of [false, true]) for (const mainRespawning of [false, true]) for (const localDead of [false, true])
  test(`mixed arena body order and participant filters match live ${observer}/${mainRespawning}/${localDead}`, () => {
    const state = createMatch({ seed: 9, combatExecution: 'live-mixed-v1', map: structuredClone(defaultGrifballMap()), teamSizes: { blue: 2, red: 1 } });
    const [ordinary, player, main] = state.combatants;
    ordinary.id = 'ordinary'; main.id = 'main_ai'; player.id = state.localPlayerId = 'player';
    state.localPlayerIsObserver = observer;
    [ordinary, player, main].forEach((a, i) => { a.pos = { x: i * .2, y: 0, z: i * .1 }; a.vel = { x: 2 - i, y: 0, z: i - 2 };
      a.hp = 1; a.alive = true; a.respawnTimer = 0; a.isCrouching = i === 0; });
    if (localDead) { player.hp = 0; player.alive = false; }
    const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: state.settings, isMultiplayer: false, multiplayerRole: null });
    live.isObserverMode = observer; live.playerHP = player.hp;
    Object.assign(live.playerPos, player.pos); Object.assign(live.playerVel, player.vel); live.otherPlayers.clear();
    for (const a of [ordinary, main]) {
      const bot = createOfflineBotCombatant({ id: a.id, playerName: a.id, team: a.team, hue: 0, difficulty: 'normal', settings: state.settings,
        spawnPos: new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), yaw: 0 });
      Object.assign(bot.vel, a.vel); bot.hp = a.hp; bot.isCrouching = a.isCrouching; bot.modelType = a.modelType;
      bot.aiState = mainRespawning && a === main ? 'RESPAWNING' : 'APPROACHING'; live.otherPlayers.set(bot.id, bot);
    }
    const memory: SimCombatPriorityMemory = { aiState: mainRespawning ? 'RESPAWNING' : 'APPROACHING', timer: 0,
      swayTimer: 0, coordCommitTimer: 0, cooldownMultiplier: 1, pendingPostEvasionCharge: false };
    const before = structuredClone(state.combatants);
    finishSimMixedArenaFrame(state, { main_ai: memory });
    resolvePlayerCombatantCollisionsForState({ state: live, mainAI: live.otherPlayers.get('main_ai'), playerModelType: player.modelType });
    const poses = [{ pos: live.playerPos, vel: live.playerVel }, ...live.otherPlayers.values()];
    for (const pose of poses) constrainCombatantToArenaBounds({ ...pose, activeCustomMap: state.map, arenaRadius: state.map.arenaRadius });
    for (const a of state.combatants) {
      const expected = a === player ? { pos: live.playerPos, vel: live.playerVel } : live.otherPlayers.get(a.id)!;
      for (const axis of ['x', 'y', 'z'] as const) { assert.equal(a.pos[axis], expected.pos[axis]); assert.equal(a.vel[axis], expected.vel[axis]); }
    }
    if (observer || localDead && mainRespawning) assert.deepEqual(state.combatants, before, 'fewer than two colliders cannot separate');
    else assert.notDeepEqual(state.combatants, before, 'overlapping live participants must separate');
  });

test('mixed arena option rejects legacy execution before mutation', () => {
  const state = createMatch({ seed: 9 }), before = structuredClone(state);
  assert.throws(() => stepSimulation(state, {}, { mixedArenaFrame: true }), /mixed execution/);
  assert.deepEqual(state, before);
});

test('mixed arena option rejects combat mode before mutation', () => {
  const state = createMatch({ seed: 9, combatExecution: 'live-mixed-v1' }); state.mode = 'combat';
  const before = structuredClone(state);
  assert.throws(() => stepSimulation(state, {}, { mixedArenaFrame: true }), /Grifball/);
  assert.deepEqual(state, before);
});
