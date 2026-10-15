import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { seededRandom, simulationRandom, withSimulationRandom } from '../../game/simulationRandom';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { resolveAIDashMovementForCombatant, type AIDashMovementFrame } from './aiDashMovementRuntime';

for (const visible of [false, true]) for (const cosmeticRandom of [0, 0.5]) {
  test(`dash visuals leave gameplay RNG and motion unchanged: scene=${visible}, roll=${cosmeticRandom}`, t => {
    t.mock.method(Math, 'random', () => cosmeticRandom);
    const state = createInitialGrifballRuntimeState({ debugMode: false,
      adminSettings: DEFAULT_ADMIN_SETTINGS, isMultiplayer: false, multiplayerRole: null });
    const refs = createInitialGrifballThreeRefs();
    if (visible) refs.scene = new THREE.Scene();
    const frame: AIDashMovementFrame = {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), dashDir: new THREE.Vector3(1, 0, 0),
      aiState: 'SIDE_STEPPING', dashRemaining: 0.25, slideActive: true, slideCooldownTimer: 0,
      pendingPostEvasionCharge: false, isSprinting: true,
    };
    const random = seededRandom(101), untouched = seededRandom(101);
    try {
      withSimulationRandom(random, 0, () => {
        for (let tick = 0; tick < 3; tick++) {
          resolveAIDashMovementForCombatant({ state, refs, frame, dt: 1 / 60, activeWeapon: 'hammer',
            targetWeaponState: 'ready', attackDistanceToTarget: 20, resolvedAiReach: 3,
            targetProtected: false, spatialIQ: 0, weaponReady: true });
          assert.equal(simulationRandom(), untouched(), 'cosmetic trail must not consume a gameplay draw');
        }
      });
      const speed = state.settings.dashDistance / (state.settings.dashDuration || 0.25);
      assert.ok(Math.abs(frame.pos.x - speed * 3 / 60) < 1e-12);
      assert.deepEqual(frame.vel.toArray(), [speed, 0, 0]);
      assert.ok(Math.abs(frame.dashRemaining - 0.2) < 1e-12);
      assert.equal(frame.slideActive, false);
      assert.equal(frame.isSprinting, false);
      assert.equal(refs.damageExplosionParticles.length, visible && cosmeticRandom > 0.15 ? 3 : 0);
    } finally {
      for (const particle of refs.damageExplosionParticles) {
        particle.mesh.geometry.dispose();
        const materials = Array.isArray(particle.mesh.material) ? particle.mesh.material : [particle.mesh.material];
        materials.forEach(material => material.dispose());
      }
      refs.scene?.clear();
    }
  });
}
