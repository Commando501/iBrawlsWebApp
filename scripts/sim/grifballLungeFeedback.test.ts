import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { tryStartComboOnHitForState } from '../../src/components/grifball/combatantCombos';
import { tryEnterCombatantPressureState } from '../../src/components/grifball/matchPressure';
import { getTacticalTargetByIdFromState } from '../../src/components/grifball/tacticalTargets';
import { finishAISwordLungeFrameForCombatant } from '../../src/components/grifball/aiSwordLungeFinishRuntime';
import { createRng } from '../../src/sim/rng';

const knobs = { difficulty: 'normal', weaponSwapIQ: 100, weaponPrioritization: 50 };
function fixture(targetId: string, pressure = true) {
  const base = createBotParityFixture('attacker', true, { enableSwordTrade: false, enableHammerSwordTrade: false }, targetId);
  const rng = createRng(7), observations: { targetId: string; hp: number; invuln: number }[] = [];
  const feedback = {
    tryEnterPressureState: (botId: string, targetId: string, targetHp: number, targetInvuln: number) => {
      observations.push({ targetId, hp: targetHp, invuln: targetInvuln });
      return tryEnterCombatantPressureState({ bot: base.state.otherPlayers.get(botId), targetId, targetHp, targetInvuln,
        pressureAggression: pressure ? 80 : 0, settings: base.state.settings, scoreContext: { scorePlayer: 0, scoreEnemy: 0 } });
    },
    tryStartComboOnHit: (botId: string, targetId: string, openingWeapon: 'sword') => tryStartComboOnHitForState({
      state: base.state, botId, targetId, openingWeapon, bot: base.state.otherPlayers.get(botId), knobs, random: rng.next,
      candidate: getTacticalTargetByIdFromState(base.state, botId, targetId, [...base.state.otherPlayers.values()]) }),
  };
  const f = attachLungeRuntime(base, feedback);
  f.bot.hp = f.bot.maxHp = 20;
  f.bot.activeWeapon = 'sword'; f.bot.aiState = 'LUNGING';
  f.target.weaponState = 'recovering'; f.target.weaponTimer = 0;
  triggerCombatantLungeAction({ self: f.bot, settings: f.state.settings, lungeDir: new THREE.Vector3(0, 0, 1), pos: f.bot.pos, vel: f.bot.vel, playDash: () => {} });
  return { ...f, feedback, observations, rng };
}

for (const targetId of ['main_ai', 'ordinary']) for (const pressure of [false, true])
  for (const stale of [false, true]) for (const lethal of [false, true])
    test(`real lunge feedback ${targetId}/pressure-${pressure}/stale-${stale}/lethal-${lethal}`, () => {
      const f = fixture(targetId, pressure);
      f.target.hp = lethal ? 1 : 2;
      if (stale) { f.state.aiHP = lethal ? 99 : 0; f.state.aiInvulnerabilityTimer = 999; }
      for (let tick = 0; tick < 10 && f.bot.isLunging; tick++) f.frame(false, false, () => { f.flight(); });
      assert.deepEqual(f.outcomes, ['hit']); assert.equal(f.target.hp, lethal ? 0 : 1);
      assert.deepEqual(f.observations, [{ targetId, hp: lethal ? 0 : 1, invuln: 0 }]);
      assert.equal(f.bot.aiState, pressure && !lethal ? 'PRESSURING' : 'COOLDOWN');
      assert.equal(f.bot.aiPressureTargetId, pressure && !lethal ? targetId : undefined);
      assert.equal(f.bot.aiPostLungeDecisionTimer, .35);
      if (lethal) assert.equal(f.state.aiMatchContext.comboState.size, 0);
      else assert.equal(f.state.aiMatchContext.comboState.get('attacker')?.comboId, 'double_tap');
      assert.equal(f.state.aiMatchContext.playerModels.get('attacker')?.lungeHits, 1);
      assert.equal(f.state.aiMatchContext.playerModels.get('attacker')?.damageDealtCount, 1);
    });

for (const targetId of ['main_ai', 'ordinary']) test(`surviving sword trade consumes both flights once: ${targetId}`, () => {
  const f = fixture(targetId); f.state.settings.enableSwordTrade = true;
  f.target.activeWeapon = 'sword'; f.target.aiState = 'LUNGING';
  triggerCombatantLungeAction({ self: f.target, settings: f.state.settings, lungeDir: new THREE.Vector3(0, 0, -1), pos: f.target.pos, vel: f.target.vel, playDash: () => {} });
  f.target.hp = 2; f.state.aiHP = 0;
  // The target's pre-existing decision reload is visible after its traded flight finishes.
  f.frame(false, false, () => { f.flight(); });
  f.frame(false, false, () => { f.flight(); });
  assert.equal(f.bot.hp, 19); assert.equal(f.target.hp, 1);
  assert.equal(f.bot.isLunging, false); assert.equal(f.target.isLunging, false);
  assert.equal(f.bot.aiState, 'PRESSURING'); assert.equal(f.target.aiState, 'PRESSURING');
  assert.deepEqual(f.observations.map(o => o.targetId), ['attacker', targetId]);
  for (const id of ['attacker', targetId]) {
    assert.equal(f.state.aiMatchContext.playerModels.get(id)?.lungeHits, 1);
    assert.equal(f.state.aiMatchContext.playerModels.get(id)?.damageDealtCount, 1);
  }
});

for (const targetId of ['main_ai', 'ordinary', 'player', 'absent']) test(`lunge completion uses current target vitals: ${targetId}`, () => {
  const f = fixture('main_ai'); f.state.aiHP = 99; f.state.aiInvulnerabilityTimer = 99;
  f.target.hp = 7; f.target.invulnerabilityTimer = .75;
  f.state.playerHP = 4; f.state.playerInvulnerabilityTimer = .25;
  if (targetId === 'ordinary') { f.state.otherPlayers.set(targetId, { ...f.target, id: targetId }); }
  finishAISwordLungeFrameForCombatant({ state: f.state, self: f.bot, botId: f.bot.id, pos: f.bot.pos, vel: f.bot.vel,
    aiState: f.bot.aiState, timer: 0, weaponState: f.bot.weaponState!, outcome: 'hit', targetId,
    recordCombatantObservation: () => {}, recordBotDamageTag: () => {}, ...f.feedback });
  const hp = targetId === 'player' ? 4 : targetId === 'absent' ? 0 : 7;
  const invuln = targetId === 'player' ? .25 : targetId === 'absent' ? 0 : .75;
  assert.deepEqual(f.observations, [{ targetId, hp, invuln }]);
});
