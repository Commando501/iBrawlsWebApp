import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createAISingleEntityUpdaterForState } from './aiSingleEntityRuntime';
import { createOfflineBotCombatant } from '../../game/roster';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { seededRandom, withSimulationRandom } from '../../game/simulationRandom';

for (const id of ['main_ai', 'ordinary']) for (const airborne of [false, true]) {
  test(`target loss cancels the dash and advances cooldowns: ${id}/${airborne}`, () => {
    const state = createInitialGrifballRuntimeState({ debugMode: false,
      adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' },
      isMultiplayer: false, multiplayerRole: null });
    const refs = createInitialGrifballThreeRefs();
    state.isObserverMode = true; state.grifball.phase = 'playing'; state.otherPlayers.clear();
    const c = createOfflineBotCombatant({ id, playerName: id, team: 'blue',
      spawnPos: new THREE.Vector3(0, airborne ? 2 : 0, 0), yaw: 0,
      hue: 0, difficulty: 'normal', settings: state.settings });
    Object.assign(c, { controller: 'ai', weaponState: 'ready', invulnerabilityTimer: 0,
      aiDashRemaining: .1, aiDashCooldownTimer: 1, aiDashDir: { x: 1, y: 0, z: 0 },
      aiSlideCooldownTimer: .8, aiHammerJumpCooldownTimer: .6, isJumping: airborne });
    state.otherPlayers.set(id, c);
    refs.otherPlayerMeshes.set(id, { group: new THREE.Group() } as never);
    const noop = () => {};
    const update = createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
      mai: () => state.otherPlayers.get('main_ai'),
      resolveBotKnobs: () => ({ difficulty: 'normal', movementComplexity: 0, weaponSwapIQ: 0,
        weaponPrioritization: 0, reactionLatency: .2, anticipationFactor: 0 }),
      resolveBotDerived: () => ({ pressureAggression: 50, spatialIQ: 50 }), resolveBotFlags: () => ({}),
      getMatchScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0, killsToWin: 25 }),
      getBestTacticalTarget: () => null, getTacticalTargetById: () => null,
      getActiveCustomMap: () => null, getOptimalSpawnPoint: () => new THREE.Vector3(),
      grifballEnemyGoalPos: () => ({ x: 30, z: 0 }),
      constrainCombatantToArena: noop, recoverCombatantAltitude: () => false,
      playDash: () => assert.fail('no target must not request another dash'),
      playJump: noop, playExplosion: noop, playDeath: noop });
    withSimulationRandom(seededRandom(1), 0, () => update(id, 1 / 60));
    assert.equal(c.aiDashRemaining, 0, 'cancelled commitment must survive frame synchronization');
    assert.ok(Math.abs(c.aiDashCooldownTimer! - (1 - 1 / 60)) < 1e-8, 'dash cooldown advances once');
    assert.ok(Math.abs(c.aiSlideCooldownTimer! - (.8 - 1 / 60)) < 1e-8, 'slide cooldown advances once');
    assert.ok(Math.abs(c.aiHammerJumpCooldownTimer! - (.6 - 1 / 60)) < 1e-8, 'jump cooldown advances once');
    if (airborne) {
      assert.ok(Math.abs(c.pos.y - (2 - 18 / 3600)) < 1e-8);
      assert.ok(Math.abs(c.vel.y + .3) < 1e-8);
    }
  });
}
