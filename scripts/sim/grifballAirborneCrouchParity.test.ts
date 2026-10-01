import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { handlePlayerKeyboardActionForState, handlePlayerKeyboardReleaseForState } from '../../src/components/grifball/playerInputRuntime';
import { triggerPlayerSwordSlashForState } from '../../src/components/grifball/playerWeaponActions';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { DEFAULT_KEYBINDINGS } from '../../src/types';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';

const noop = () => {};
for (const execution of ['live-player-v1', 'live-mixed-v1'] as const)
  for (const targetId of ['main_ai', 'target']) for (const mirror of [false, true]) for (const crouching of [false, true])
    test(`airborne crouch slash ${execution}/${targetId}/${mirror}/${crouching}`, () => {
      const f = createBotParityFixture('player', false, { swordSlashSpeed: .1, enableSwordTrade: false, enableHammerSwordTrade: false }, targetId);
      const { sim, state, refs, target } = f, [self, rival] = sim.combatants, sign = mirror ? -1 : 1;
      sim.combatExecution = execution; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
      self.id = 'player'; rival.id = targetId; state.otherPlayers.delete('player');
      state.localPlayerTeam = self.team = mirror ? 'red' : 'blue'; target.team = rival.team = mirror ? 'blue' : 'red';
      self.pos = { x: 0, y: 2, z: 0 }; self.vel = { x: 0, y: 3, z: 0 }; self.isJumping = true; self.grounded = false;
      state.playerPos.set(0, 2, 0); state.playerVel.set(0, 3, 0); state.isJumping = true;
      self.yaw = mirror ? Math.PI : 0; state.yaw = self.yaw + Math.PI; state.pitch = -.5;
      target.pos.set(0, 0, sign * .9 * Math.cos(.5)); rival.pos = { x: 0, y: 0, z: target.pos.z };
      self.hp = self.maxHp = state.playerHP = state.playerMaxHP = rival.hp = rival.maxHp = target.hp = target.maxHp = 20;
      self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = rival.weaponReadyTimer = 0;
      self.weapon = state.activeWeapon = 'sword'; state.pSwordState = state.pWeaponState = 'ready';
      state.pSwordTimer = state.pWeaponTimer = state.swapCooldownTimer = state.swapLockoutTimer = 0;
      let firstLiveHit = 0, firstSimHit = 0; const differences: string[] = [];
      for (let tick = 1; tick <= 60; tick++) {
        if (tick === 1) {
          if (crouching) handlePlayerKeyboardActionForState({ state, key: DEFAULT_KEYBINDINGS.crouch, rawKey: DEFAULT_KEYBINDINGS.crouch,
            repeat: false, keybindings: DEFAULT_KEYBINDINGS, keysPressed: {}, isPaused: false, isPlaying: true,
            callbacks: { onPauseToggle: noop, swapPlayerWeapon: noop, recordDashObservation: noop,
              spawnVoxelShockwaveParticles: noop, pushStatsUpdate: noop, playCrouch: noop, playJump: noop, playDash: noop } });
          triggerPlayerSwordSlashForState({ state, playSwing: noop, sendSync: noop });
        }
        if (tick === 30) handlePlayerKeyboardReleaseForState({ state, key: DEFAULT_KEYBINDINGS.crouch, keybindings: DEFAULT_KEYBINDINGS, pushStatsUpdate: noop });
        updatePlayerHorizontalMovementForState({ state, refs, dt: 1/60, keysPressed: {}, movementKeybindings: DEFAULT_KEYBINDINGS,
          actionKeybindings: DEFAULT_KEYBINDINGS, gamepad: null, mobileJoystick: null, mobileControlsActive: false,
          sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false } });
        updatePlayerVerticalIntegrationForState({ state, dt: 1/60, gravityAcceleration: 18, constrainCombatantToArena: noop });
        f.weaponFrame(1/60);
        stepSimulation(sim, { player: { ...idleAction(), aim: mirror ? Math.PI : 0, aimPitch: -.5,
          crouch: crouching && tick < 30, attackPrimary: tick === 1 } }, { settings: sim.settings });
        const currentSelf = sim.combatants.find(c => c.id === 'player')!, currentTarget = sim.combatants.find(c => c.id === targetId)!;
        if (target.hp < 20 && !firstLiveHit) firstLiveHit = tick;
        if (currentTarget.hp < 20 && !firstSimHit) firstSimHit = tick;
        if (currentSelf.isCrouching !== state.isCrouching) differences.push(`${tick}/stance`);
        if (Math.abs((currentSelf.crouchAmount ?? 0)-state.crouchAmount)>=1e-9) differences.push(`${tick}/eye`);
        assert.ok(Math.abs(currentSelf.pos.y-state.playerPos.y)<1e-9, `${tick}/height`);
        if (currentTarget.hp !== target.hp) differences.push(`${tick}/damage`);
        if (tick === 3) {
          const height = 2 + 3*3/60 - 18/(60*60)*3*4/2;
          const crouch = crouching ? .72*(1-.8**3) : 0;
          const vertical = 1.65 + height - crouch - .825, forward = .9*Math.cos(.5);
          const distance = Math.hypot(vertical, forward), angle = Math.abs(Math.atan2(vertical, forward)-.5);
          assert.equal(distance <= 2.8 && angle <= 1, crouching, 'independent eye-origin cone oracle');
          assert.equal(target.hp, crouching ? 19 : 20);
        }
        if (tick === 2) Object.assign(sim, JSON.parse(JSON.stringify(sim)));
      }
      assert.equal(firstLiveHit, crouching ? 3 : 0);
      assert.equal(differences.length, 0, differences.slice(0, 12).join(', '));
      assert.equal(firstSimHit, firstLiveHit);
    });

for (const execution of [undefined, 'legacy-v1', 'live-roster-v1', 'live-roster-v2', 'live-mixed-v1'] as const)
  test(`airborne crouch preserves non-player execution ${execution ?? 'default'}`, () => {
    const { sim } = createBotParityFixture('main_ai', false, {}, 'target');
    sim.combatExecution = execution;
    sim.localPlayerId = sim.combatants[1].id;
    sim.match.phase = 'playing';
    const actor = sim.combatants[0];
    actor.pos.y = 2; actor.vel.y = 3; actor.isJumping = true; actor.grounded = false;
    stepSimulation(sim, { [actor.id]: { ...idleAction(), crouch: true } }, { settings: sim.settings });
    assert.equal(actor.isCrouching, false);
    assert.equal(actor.crouchAmount ?? 0, 0);
    assert.ok(actor.pos.y > 2);
  });
