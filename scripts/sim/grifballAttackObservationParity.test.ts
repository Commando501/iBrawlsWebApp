import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { observeSimGrifballSpace } from '../../src/sim/grifballTacticalAdapter';
import { createLiveGrifballTacticalSnapshot } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { triggerPlayerHammerSwingForState, triggerPlayerHammerMeleeForState, triggerPlayerSwordSlashForState } from '../../src/components/grifball/playerWeaponActions';
import { setSimCarrier } from '../../src/sim/grifball';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { observeGrifballSpace } from '../../src/game/aiGrifballSpace';

const noop = () => {};
for (const owner of ['player', 'main_ai', 'bot_2'] as const)
  for (const kind of ['slash', 'slam', 'swipe', 'punch'] as const)
    for (const tuned of [false, true]) test(`attack observations follow actual impacts ${owner}/${kind}/${tuned}`, () => {
      const f = createBotParityFixture(owner, owner !== 'player', tuned ? {
        swordSlashSpeed: .35, swordSlashReload: .75, hammerMeleeSpeed: .37, hammerMeleeReload: .43,
        hammerSlamWindupTime: .08, hammerSlamAttackTime: .04, hammerReloadTime: .31, grifballPunchCooldown: .75,
      } : {});
      const { sim, state, bot, target } = f, [self, rival] = sim.combatants;
      const local = owner === 'player', weapon = kind === 'slash' ? 'sword' : kind === 'punch' ? 'ball' : 'hammer';
      sim.combatExecution = local ? 'live-player-v1' : 'live-roster-v2'; sim.match.phase = 'playing';
      self.id = owner; rival.id = target.id; self.weapon = bot.activeWeapon = state.activeWeapon = weapon;
      self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: 2 };
      self.hp = self.maxHp = bot.hp = state.playerHP = state.playerMaxHP = 20;
      rival.hp = rival.maxHp = target.hp = target.maxHp = 20;
      self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = rival.weaponReadyTimer = 0;
      state.swapCooldownTimer = state.swapLockoutTimer = 0;
      state.playerPos.set(0, 0, 0); state.yaw = Math.PI;
      state.pWeaponState = state.pSwordState = 'ready'; state.pWeaponTimer = state.pSwordTimer = 0;
      if (local) state.otherPlayers.delete(owner);
      if (weapon === 'ball') {
        sim.match.ball.state = state.grifball.ball.state = 'held';
        sim.match.ball.holderId = state.grifball.ball.holderId = owner;
        setSimCarrier(self, true, sim.settings); setGrifballCarrierForState({ state, id: owner, carrying: true });
      }
      const frames: { tick: number; attackIn: number; hp: number }[] = [];
      const impacts: number[] = [];
      for (let tick = 1; tick <= 240; tick++) {
        const secondary = kind === 'swipe' && tick === 1;
        // After the authored opening, request primary whenever ready: the observation
        // predicts the next primary opportunity, not hidden future attack choices.
        if (local) {
          const phase = weapon === 'sword' ? state.pSwordState : state.pWeaponState;
          if (phase === 'ready') {
            const args = { state, recordHammerAttack: noop, playSwing: noop, sendSync: noop };
            if (secondary) triggerPlayerHammerMeleeForState(args);
            else if (weapon === 'sword') triggerPlayerSwordSlashForState(args);
            else triggerPlayerHammerSwingForState(args);
          }
          f.weaponFrame(1 / 60);
        } else f.frame(true, secondary);
        stepSimulation(sim, { [owner]: { ...idleAction(), attackPrimary: !secondary, attackSecondary: secondary } }, { settings: sim.settings });
        const live = createLiveGrifballTacticalSnapshot(state, team => sim.goalPlates.find(p => p.team !== team)?.position ?? null, f.map)
          .players.find(p => p.id === owner)!.space!;
        const headless = observeSimGrifballSpace(self, sim.settings, sim.combatExecution);
        assert.equal(target.hp, rival.hp, `damage tick ${tick}`);
        for (const key of Object.keys(live) as (keyof typeof live)[]) {
          const a = live[key], b = headless[key];
          if (typeof a === 'number' && typeof b === 'number') assert.ok(Math.abs(a - b) < 1e-6, `${key} tick ${tick}: ${a} != ${b}`);
          else assert.equal(a, b, `${key} tick ${tick}`);
        }
        if (target.hp < (frames.at(-1)?.hp ?? 20)) impacts.push(tick);
        frames.push({ tick, attackIn: live.attackIn, hp: target.hp });
      }
      assert.ok(impacts.length >= 2, 'must observe repeated real damage');
      let checked = 0;
      for (const frame of frames) {
        const next = impacts.find(tick => tick > frame.tick);
        if (next === undefined) continue;
        const seconds = (next - frame.tick) / 60;
        // Animation phases each quantize to the next simulation tick. At most
        // three phase boundaries separate a forecast from the next real impact.
        assert.ok(seconds + 1e-6 >= frame.attackIn && seconds <= frame.attackIn + 3 / 60 + 1e-6,
          `forecast tick ${frame.tick}: estimated ${frame.attackIn}, actual ${seconds}`);
        checked++;
      }
      assert.ok(checked > 60, 'must check forecasts through attack, follow-through and recovery');
    });

for (const owner of ['player', 'main_ai', 'bot_2'] as const) test(`visible readiness and lunge observations ${owner}`, () => {
  const f = createBotParityFixture(owner, owner !== 'player'), { sim, state, bot } = f, self = sim.combatants[0];
  const local = owner === 'player', execution = local ? 'live-player-v1' : 'live-roster-v2';
  self.id = owner; self.weapon = bot.activeWeapon = state.activeWeapon = 'sword';
  state.pSwordState = 'ready'; state.pSwordTimer = 0;
  if (local) state.otherPlayers.delete(owner);
  const liveSpace = () => createLiveGrifballTacticalSnapshot(state, () => null, f.map).players.find(p => p.id === owner)!.space!;
  // Swap frequency lockout can outlast the weapon-ready delay and must not hide
  // an otherwise available attack. Both clocks are directly visible mechanics.
  state.swapLockoutTimer = bot.swapLockoutTimer = self.swapLockoutTimer = 10;
  state.swapCooldownTimer = bot.swapCooldownTimer = self.weaponReadyTimer = .3;
  self.attackCooldown = 0;
  assert.equal(liveSpace().attackIn, .3 + sim.settings.swordSlashSpeed * .5);
  assert.equal(liveSpace().attackIn, observeSimGrifballSpace(self, sim.settings, execution).attackIn);
  state.isLunging = bot.isLunging = self.isLunging = true;
  for (const observation of [liveSpace(), observeSimGrifballSpace(self, sim.settings, execution)]) {
    assert.equal(observation.phase, 'lunging'); assert.equal(observation.attackIn, 0);
  }
  state.isLunging = bot.isLunging = self.isLunging = false;
  state.swapCooldownTimer = bot.swapCooldownTimer = self.weaponReadyTimer = 0;
  state.pSwordState = bot.weaponState = 'recovering'; self.weaponState = 'recovering';
  state.pSwordTimer = bot.weaponTimer = .2;
  state.pSwordRecoverDuration = local ? 1.2 : sim.settings.swordSlashReload;
  self.weaponTimer = self.attackCooldown = state.pSwordRecoverDuration - .2;
  assert.equal(liveSpace().attackIn, observeSimGrifballSpace(self, sim.settings, execution).attackIn);
});

test('punch recovery uses the same bounded setting as execution', () => {
  const { sim } = createBotParityFixture();
  const observation = observeGrifballSpace({ ...sim.settings, grifballPunchCooldown: 0 }, 'ball', 'recovering');
  assert.equal(observation.attackIn, .1 + sim.settings.hammerMeleeSpeed + Math.max(.03, sim.settings.hammerMeleeSpeed * .5));
});
