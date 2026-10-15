import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOfflineBotCombatant } from '../../game/roster';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { recoverAirborneCombatantForFrame } from './aiAirborneRecoveryRuntime';
import { integrateTargetEngagementGravityForCombatant } from './aiEngagementFrameRuntime';
import { canStartAIHammerJumpForCombatant } from './combatantActions';
import { resolveAIEmergencyHopDodgeForCombatant } from './aiSpatialDodgeRuntime';
import { createInitialGrifballRuntimeState } from './runtimeState';

for (const id of ['main_ai', 'bot_2']) for (const owner of ['recovery', 'engagement']) {
  test(`${owner} landing restores ${id}'s air-jump budget before the next decision`, () => {
    const self = createOfflineBotCombatant({ id, playerName: id, team: 'blue',
      spawnPos: new THREE.Vector3(0, 1, 0), yaw: 0, hue: 0, difficulty: 'normal', settings: DEFAULT_ADMIN_SETTINGS });
    Object.assign(self, { isJumping: true, aiHammerJumpsInAir: 1, weaponState: 'ready' });
    self.vel.set(0, -1, 0);
    const settings = { hammerJumpAirLimit: 1, hammerJumpPower: 6.5 };
    const step = () => {
      const args = { self, dt: 1 / 60, gravityAcceleration: 18,
        recoverCombatantAltitude: () => false, constrainCombatantToArena: () => {} };
      if (owner === 'recovery') recoverAirborneCombatantForFrame({ ...args, pos: self.pos, vel: self.vel });
      else integrateTargetEngagementGravityForCombatant({ ...args, frame: { pos: self.pos, vel: self.vel,
        aiState: 'APPROACHING', timer: 0, dashCooldownTimer: 0, slideCooldownTimer: 0, hammerJumpCooldownTimer: 0 } });
    };
    step();
    assert.equal(self.aiHammerJumpsInAir, 1, 'falling must not replenish the budget');
    assert.equal(canStartAIHammerJumpForCombatant(self, settings), false);
    self.pos.y = .01;
    step();
    assert.equal(self.pos.y, 0); assert.equal(self.vel.y, 0); assert.equal(self.isJumping, false);
    assert.equal(self.aiHammerJumpsInAir, 0);
    assert.equal(canStartAIHammerJumpForCombatant(self, settings), true);
  });
}

for (const verticalSpeed of [-3.4, 5.5]) test(`an airborne emergency dodge does not integrate height again at ${verticalSpeed}m/s`, () => {
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: DEFAULT_ADMIN_SETTINGS,
    isMultiplayer: false, multiplayerRole: null });
  const self = createOfflineBotCombatant({ id: 'main_ai', playerName: 'main', team: 'blue',
    spawnPos: new THREE.Vector3(0, 5, 0), yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
  self.isJumping = true; self.vel.y = verticalSpeed;
  let sounds = 0;
  resolveAIEmergencyHopDodgeForCombatant({ state, self, pos: self.pos, vel: self.vel, dt: 1 / 60,
    lungeDirX: 1, lungeDirZ: 0, playerModel: null, playJump: () => sounds++ });
  assert.equal(self.pos.y, 5); assert.equal(self.vel.y, verticalSpeed); assert.equal(sounds, 0);
  assert.ok(Math.hypot(self.pos.x, self.pos.z) > 0, 'horizontal evasion must still execute');
});
