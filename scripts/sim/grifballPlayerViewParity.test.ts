import assert from 'node:assert/strict';
import test from 'node:test';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { triggerPlayerHammerSwingForState, triggerPlayerHammerMeleeForState, triggerPlayerSwordSlashForState } from '../../src/components/grifball/playerWeaponActions';
import { updatePlayerHorizontalMovementForState } from '../../src/components/grifball/playerMovementRuntime';
import { DEFAULT_KEYBINDINGS } from '../../src/types';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import { setSimCarrier } from '../../src/sim/grifball';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { stepCombatantMovement } from '../../src/sim/physics';
import { respawnCombatant } from '../../src/sim/weapons';
import { hashState } from '../../src/sim/hash';
const cases = [
  { name: 'slash-up-miss', kind: 'slash', pitch: .8, z: 2, hit: false },
  { name: 'slash-crouch-hit', kind: 'slash', pitch: 0, crouch: true, z: 2.7, hit: true },
  { name: 'swipe-crouch-hit', kind: 'swipe', pitch: 0, crouch: true, z: 2.95, hit: true },
  { name: 'slam-down-hit', kind: 'slam', pitch: -Math.asin(.825 / 3.2), z: Math.sqrt(3.2 ** 2 - .825 ** 2), hit: true },
  { name: 'punch-up-miss', kind: 'punch', pitch: .8, z: 1.8, hit: false },
  { name: 'large-slash-hit', kind: 'slash', pitch: 0, large: true, z: 2.85, hit: true },
  { name: 'large-swipe-hit', kind: 'swipe', pitch: 0, large: true, z: 3.05, hit: true },
  { name: 'large-slam-hit', kind: 'slam', pitch: -Math.asin(.825 / 3.2), x: .35, large: true, z: Math.sqrt(3.2 ** 2 - .825 ** 2), hit: true },
  { name: 'large-punch-hit', kind: 'punch', pitch: 0, large: true, z: 3.2, hit: true },
  { name: 'crouched-target-slam-hit', kind: 'slam', pitch: -Math.asin(.825 / 3.2), targetCrouch: true, z: Math.sqrt(3.2 ** 2 - .825 ** 2), hit: true },
] as const;
const samples = [...cases, ...cases.filter(spec => 'large' in spec).map(spec => ({ ...spec, name: spec.name.replace('large-', 'medium-'), large: false, hit: false }))];
for (const execution of ['live-player-v1', 'live-mixed-v1'] as const)
  for (const targetId of ['main_ai', 'target'])
    for (const spec of samples)
      test(`${execution}/${targetId}/${spec.name}`, () => {
        const f = createBotParityFixture('player', false, { attackRadius: .2, enableSwordTrade: false, enableHammerSwordTrade: false }, targetId);
        const { sim, state, refs, target } = f, [self, rival] = sim.combatants;
        sim.combatExecution = execution;
        sim.localPlayerId = 'player';
        sim.match.phase = 'playing';
        self.id = 'player';
        rival.id = targetId;
        state.otherPlayers.delete('player');
        self.pos = { x: 0, y: 0, z: 0 };
        self.yaw = 0;
        state.playerPos.set(0, 0, 0);
        state.yaw = Math.PI;
        state.pitch = spec.pitch;
        self.hp = self.maxHp = state.playerHP = state.playerMaxHP = rival.hp = rival.maxHp = target.hp = target.maxHp = 20;
        self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = rival.weaponReadyTimer = 0;
        target.modelType = rival.modelType = 'large' in spec && spec.large ? 'large' : 'medium';
        const targetCrouch = 'targetCrouch' in spec && spec.targetCrouch;
        target.isCrouching = rival.isCrouching = targetCrouch;
        const x = 'x' in spec ? spec.x : 0;
        target.pos.set(x, 0, spec.z);
        rival.pos = { x, y: 0, z: spec.z };
        self.weapon = state.activeWeapon = spec.kind === 'slash' ? 'sword' : spec.kind === 'punch' ? 'ball' : 'hammer';
        state.pWeaponState = state.pSwordState = 'ready';
        state.pWeaponTimer = state.pSwordTimer = state.swapCooldownTimer = state.swapLockoutTimer = 0;
        if (spec.kind === 'punch') {
          sim.match.ball.state = state.grifball.ball.state = 'held';
          sim.match.ball.holderId = state.grifball.ball.holderId = 'player';
          setSimCarrier(self, true, sim.settings);
          setGrifballCarrierForState({ state, id: 'player', carrying: true });
        }
        const differences: string[] = [];
        for (let tick = 1; tick <= 90; tick++) {
          const crouch = 'crouch' in spec && tick < 30;
          state.isCrouching = crouch;
          if (tick === 1) {
            const args = { state, recordHammerAttack: () => { }, playSwing: () => { }, sendSync: () => { } };
            if (spec.kind === 'slash')
              triggerPlayerSwordSlashForState(args);
            else if (spec.kind === 'swipe')
              triggerPlayerHammerMeleeForState(args);
            else
              triggerPlayerHammerSwingForState(args);
          }
          updatePlayerHorizontalMovementForState({ state, refs, dt: 1 / 60, keysPressed: {}, movementKeybindings: DEFAULT_KEYBINDINGS, actionKeybindings: DEFAULT_KEYBINDINGS, gamepad: null, mobileJoystick: null, mobileControlsActive: false, sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false } });
          f.weaponFrame(1 / 60);
          stepSimulation(sim, { player: { ...idleAction(), aim: 0, aimPitch: spec.pitch, crouch, attackPrimary: tick === 1 && spec.kind !== 'swipe', attackSecondary: tick === 1 && spec.kind === 'swipe' }, [targetId]: { ...idleAction(), crouch: targetCrouch } }, { settings: sim.settings });
          const currentSelf = sim.combatants.find(c => c.id === 'player')!, currentTarget = sim.combatants.find(c => c.id === targetId)!;
          if (target.hp !== currentTarget.hp)
            differences.push(`damage@${tick} ${target.hp} != ${currentTarget.hp}`);
          assert.equal(currentSelf.pitch, state.pitch);
          assert.ok(Math.abs((currentSelf.crouchAmount ?? 0) - state.crouchAmount) < 1e-9, `crouch height tick ${tick}`);
          if (spec.kind === 'slam' && currentSelf.weaponState === 'recovering' && currentSelf.weaponPhaseElapsed === 0)
            assert.equal(currentSelf.hammerJumpWindowTimer, state.pHammerJumpWindowTimer, 'pitched impact opens the same jump window');
          // Resume every attack from serialized pre-impact state, including partial crouch.
          if (tick === 3)
            Object.assign(sim, JSON.parse(JSON.stringify(sim)));
        }
        assert.equal(target.hp, 20 - Number(spec.hit), 'independent live hit/miss sentinel');
        assert.equal(differences.length, 0, differences.slice(0, 5).join('\n'));
      });
test('player view limits, persistence, dash interpolation and revival follow the live contract', () => {
  const { sim } = createBotParityFixture(), self = sim.combatants[0];
  sim.combatExecution = 'live-mixed-v1';
  sim.localPlayerId = self.id;
  self.pitch = .4;
  self.crouchAmount = .3;
  self.weaponReadyTimer = 0;
  stepCombatantMovement(sim, self, { ...idleAction(), aimPitch: 10, crouch: true }, sim.settings, 1 / 60);
  assert.equal(self.pitch, Math.PI / 2.3);
  const height = self.crouchAmount;
  self.dashRemaining = .1;
  stepCombatantMovement(sim, self, { ...idleAction(), aimPitch: -10 }, sim.settings, 1 / 60);
  assert.equal(self.pitch, -Math.PI / 2.3);
  assert.equal(self.crouchAmount, height, 'dash holds the view height');
  stepCombatantMovement(sim, self, idleAction(), sim.settings, 1 / 60);
  assert.equal(self.pitch, -Math.PI / 2.3, 'omitted pitch preserves view');
  assert.throws(() => stepCombatantMovement(sim, self, { ...idleAction(), aimPitch: NaN }, sim.settings, 1 / 60), /finite/);
  respawnCombatant(sim, self, sim.settings);
  assert.equal(self.pitch, 0);
  assert.equal(self.crouchAmount, height, 'live revival preserves the current crouch interpolation');
});
test('view geometry affects versioned hashes and survives a JSON continuation', () => {
  const { sim } = createBotParityFixture(), self = sim.combatants[0];
  sim.combatExecution = 'live-mixed-v1';
  sim.localPlayerId = self.id;
  const baseline = hashState(sim);
  self.pitch = .4;
  assert.notEqual(hashState(sim), baseline);
  const pitched = hashState(sim);
  self.crouchAmount = .3;
  assert.notEqual(hashState(sim), pitched);
  assert.equal(hashState(JSON.parse(JSON.stringify(sim))), hashState(sim));
  self.pitch = 0;
  self.crouchAmount = 0;
  assert.equal(hashState(sim), baseline);
});
for (const execution of ['legacy-v1', 'live-roster-v1', 'live-roster-v2'] as const)
  test(`optional player-view input cannot alter ${execution} movement or hashes`, () => {
    const { sim } = createBotParityFixture();
    sim.combatExecution = execution;
    const control = structuredClone(sim), self = sim.combatants[0];
    stepCombatantMovement(sim, self, { ...idleAction(), aimPitch: .8, crouch: true }, sim.settings, 1 / 60);
    stepCombatantMovement(control, control.combatants[0], { ...idleAction(), crouch: true }, control.settings, 1 / 60);
    assert.deepEqual(sim, control);
    const before = hashState(sim);
    self.pitch = .8;
    self.crouchAmount = .5;
    assert.equal(hashState(sim), before);
  });
