import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch } from '../../sim/factory';
import { tickGrifballObjective } from '../../sim/grifball';
import { createOfflineBotCombatant } from '../../game/roster';
import { throwBall } from '../../game/grifballBall';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { getLiveBallContactColliders } from './grifballBallCollisionRuntime';
import { updateGrifballObjectiveForState } from './grifballObjectiveRuntime';

function fixture() {
  const sim = createMatch({ seed: 71, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 1 } });
  const [player, bot] = sim.combatants;
  sim.localPlayerId = player.id = 'player';
  player.controller = 'remote'; bot.id = 'bot';
  sim.match.phase = 'playing';
  const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: { ...sim.settings }, isMultiplayer: false, multiplayerRole: null });
  live.otherPlayers.clear(); live.grifball = structuredClone(sim.match);
  live.playerRespawnTimer = 0; live.playerHP = player.hp; live.activeWeapon = 'hammer';
  live.playerPos.set(20, 0, 20); player.pos = { x: 20, y: 0, z: 20 };
  const actor = createOfflineBotCombatant({ id: 'bot', playerName: 'bot', team: 'red',
    spawnPos: new THREE.Vector3(), yaw: Math.PI, hue: 0, difficulty: 'normal', settings: live.settings, modelType: 'medium' });
  actor.hp = bot.hp; actor.respawnTimer = 0; live.otherPlayers.set(actor.id, actor);
  bot.pos = { x: 0, y: 0, z: 0 }; bot.vel = { x: 0, y: 0, z: 0 };
  const refs = createInitialGrifballThreeRefs();
  return { sim, live, player, bot, actor, tick: (dt: number) => {
    updateGrifballObjectiveForState({ state: live, refs, ballMeshRef: { current: null }, ballChargingRef: { current: false },
      ballChargeTimerRef: { current: 0 }, dt, isMultiplayer: false, activeCustomMap: sim.map,
      placeCombatantsAtGrifballSpawns: () => {}, pushStatsUpdate: () => {} });
    tickGrifballObjective(sim, sim.settings, dt);
  } };
}

for (const target of ['player', 'ai', 'remote'] as const) {
  for (const weapon of ['hammer', 'sword'] as const) {
    test(`${target} ${weapon}: live and headless contact produce identical flight`, () => {
      const f = fixture();
      const actor = target === 'player' ? f.player : f.bot;
      actor.weapon = weapon; actor.weaponState = 'idle'; actor.weaponPhaseElapsed = 0; actor.yaw = 0;
      if (target === 'player') {
        f.player.pos = { x: 0, y: 0, z: 0 }; f.live.playerPos.set(0, 0, 0);
        f.bot.pos = { x: 20, y: 0, z: 20 }; f.actor.pos.set(20, 0, 20);
        f.live.yaw = Math.PI; f.live.activeWeapon = weapon;
        f.live.pWeaponState = f.live.pSwordState = 'ready';
        f.live.pWeaponTimer = f.live.pSwordTimer = 0;
      } else {
        f.actor.yaw = Math.PI; f.actor.activeWeapon = weapon; f.actor.weaponState = 'ready'; f.actor.weaponTimer = 0;
        if (target === 'remote') { f.bot.controller = 'remote'; f.actor.controller = 'remote'; }
      }
      // Pass across the equipped weapon, in front of (and outside) the body.
      const y = weapon === 'hammer' ? 1.65 : 1.1;
      const z = weapon === 'hammer' ? .56 : 1.25;
      for (const ball of [f.live.grifball.ball, f.sim.match.ball])
        throwBall(ball, { x: -3, y, z }, { x: 1, y: 0, z: 0 }, 30, 0);
      let deflected = false;
      for (let i = 0; i < 24; i++) {
        f.tick(1 / 60);
        assert.deepEqual(f.live.grifball.ball, f.sim.match.ball);
        if (f.live.grifball.ball.vel.x < 0) deflected = true;
      }
      assert.equal(deflected, true);
      assert.equal(f.live.playerHP, f.player.hp);
      assert.equal(f.actor.hp, f.bot.hp);
    });
  }
}

test('dead, respawning, and observer actors contribute no ball collision', () => {
  const f = fixture();
  f.live.isObserverMode = true;
  f.actor.hp = 0;
  assert.equal(getLiveBallContactColliders(f.live, .016).length, 0);
  f.actor.hp = 2; f.actor.respawnTimer = 1;
  assert.equal(getLiveBallContactColliders(f.live, .016).length, 0);
  f.actor.respawnTimer = 0; f.actor.isObserver = true;
  assert.equal(getLiveBallContactColliders(f.live, .016).length, 0);
});

test('a pickup request takes precedence over pushing a loose ball', () => {
  const f = fixture();
  f.actor.pos.set(0, 0, 0); f.actor.pickupRequested = true;
  f.live.isObserverMode = true;
  assert.equal(getLiveBallContactColliders(f.live, .016).length, 0);
  f.live.grifball.ball.state = 'thrown';
  assert.ok(getLiveBallContactColliders(f.live, .016).length > 0, 'a request does not make a thrown pass intangible');
});
