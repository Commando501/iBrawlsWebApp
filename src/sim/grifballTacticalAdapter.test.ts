import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch } from './factory';
import { createSimGrifballTacticalSnapshot, observeSimGrifballSpace } from './grifballTacticalAdapter';
import { createLiveGrifballTacticalSnapshot } from '../components/grifball/grifballTeamPlanRuntime';
import { createInitialGrifballRuntimeState } from '../components/grifball/runtimeState';
import { createOfflineBotCombatant } from '../game/roster';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../game/grifballTacticsConfig';
import { resolveHammerSlamTiming } from '../game/hammerSlamTiming';

function fixture() {
  const sim = createMatch({ seed: 17, settings: { aiDifficulty: 'normal' } });
  sim.match.phase = 'playing';
  const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: sim.settings, isMultiplayer: false, multiplayerRole: null });
  live.isObserverMode = false; live.arenaRadius = sim.map.arenaRadius;
  live.grifball = structuredClone(sim.match); live.grifballTactics = defaultGrifballTactics();
  live.otherPlayers.clear();
  for (const c of sim.combatants) {
    if (c.id === 'player') {
      live.localPlayerTeam = c.team; live.playerPos.set(c.pos.x, c.pos.y, c.pos.z); live.playerVel.set(c.vel.x, c.vel.y, c.vel.z);
      live.yaw = c.yaw; live.playerHP = c.hp; live.playerRespawnTimer = 0; live.activeWeapon = 'hammer';
      live.pWeaponState = 'ready'; live.pWeaponTimer = 0; live.swapLockoutTimer = 0; live.playerPickupRequested = undefined;
      continue;
    }
    const bot = createOfflineBotCombatant({ id: c.id, playerName: c.id, team: c.team, spawnPos: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z),
      yaw: c.yaw, hue: 0, difficulty: 'normal', settings: sim.settings });
    Object.assign(bot, { controller: c.controller, activeWeapon: c.weapon, weaponState: 'ready', weaponTimer: 0, respawnTimer: 0, swapLockoutTimer: 0, pickupRequested: undefined });
    live.otherPlayers.set(c.id, bot);
  }
  const scriptedBots = Object.fromEntries(sim.combatants.filter(c => c.controller === 'ai').map(c => [c.id, 'normal']));
  const goals = (team: string | undefined) => sim.goalPlates.find(p => p.team !== team)?.position ?? null;
  return { sim, live, scriptedBots, goals };
}

test('equivalent ready-hammer live/headless fixtures produce identical versioned observations and team plans', () => {
  const { sim, live, scriptedBots, goals } = fixture();
  const headless = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
  const runtime = createLiveGrifballTacticalSnapshot(live, goals, sim.map);
  assert.deepEqual(headless, runtime);
  assert.equal(headless.contractVersion, 1);
  const a = createGrifballTeamPlanState(), b = createGrifballTeamPlanState();
  for (let tick = 0; tick < 8; tick++) {
    const c = sim.combatants[1]; c.pos.x += 0.2; c.vel.x = 2;
    live.otherPlayers.get(c.id)!.pos.x = c.pos.x; live.otherPlayers.get(c.id)!.vel.x = 2;
    updateGrifballTeamPlan(a, createSimGrifballTacticalSnapshot(sim, { scriptedBots }), 1 / 60);
    updateGrifballTeamPlan(b, createLiveGrifballTacticalSnapshot(live, goals, sim.map), 1 / 60);
    assert.deepEqual(a, b);
  }
});

test('snapshot data is detached and headless ownership defaults to observation-only', () => {
  const { sim, scriptedBots } = fixture(); const tactics = defaultGrifballTactics();
  const snapshot = createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics });
  const original = structuredClone(snapshot);
  sim.combatants[0].pos.x += 50; sim.match.ball.pos.z += 40; tactics.defaults.styleAggression = 1;
  assert.deepEqual(snapshot, original);
  assert.ok(createSimGrifballTacticalSnapshot(sim, { scriptedBots: {} }).players.every(p => !p.scripted));
  sim.mode = 'combat'; assert.throws(() => createSimGrifballTacticalSnapshot(sim, { scriptedBots }), /Grifball/);
});

test('headless remaining timers reflect its execution model, including known sword and punch timing differences', () => {
  const { sim } = fixture(); const c = sim.combatants[1]; const timing = resolveHammerSlamTiming(sim.settings);
  c.weaponState = 'windup'; c.weaponTimer = 0.17; c.attackKind = 'strike';
  assert.equal(observeSimGrifballSpace(c, sim.settings).attackIn, 0.17);
  c.weaponState = 'recovering'; c.weaponTimer = 0.3; c.attackCooldown = 0.3;
  assert.ok(Math.abs(observeSimGrifballSpace(c, sim.settings).attackIn - (0.3 + timing.windupTime + timing.attackTime)) < 1e-10);
  c.weaponState = 'idle'; c.attackCooldown = 0; c.weaponReadyTimer = 0.5; c.swapLockoutTimer = 10;
  assert.ok(Math.abs(observeSimGrifballSpace(c, sim.settings).attackIn - (0.5 + timing.windupTime + timing.attackTime)) < 1e-10);
  c.weaponReadyTimer = 0; c.weapon = 'sword';
  assert.equal(observeSimGrifballSpace(c, sim.settings).attackIn, sim.settings.swordSlashSpeed);
  c.weapon = 'ball'; assert.equal(observeSimGrifballSpace(c, sim.settings).attackIn, sim.settings.hammerMeleeSpeed);
  c.isLunging = true; assert.equal(observeSimGrifballSpace(c, sim.settings).attackIn, 0);
  c.pos.y = 2; c.vel.y = 4; assert.ok(observeSimGrifballSpace(c, sim.settings).mobileIn > 0.7);
});

test('dead members retain roster identity and use the actual headless respawn slot', () => {
  const { sim, scriptedBots } = fixture(); const c = sim.combatants[1];
  const before = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
  c.alive = false; c.hp = 0; c.respawnTimer = 2;
  const after = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
  assert.equal(before.rosterKey, after.rosterKey); assert.ok(!after.players.some(p => p.id === c.id));
  const index = sim.combatants.filter(p => p.team === c.team).indexOf(c);
  const spawn = sim.spawns[c.team][index % sim.spawns[c.team].length];
  assert.deepEqual(after.respawns![0].pos, { x: spawn.x, z: spawn.z }); assert.equal(after.respawns![0].seconds, 2);
});
