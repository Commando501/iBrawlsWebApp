import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { resolveAISwordLungeFlightForCombatant } from '../../src/components/grifball/aiSwordLungeFlightRuntime';
import { finishAISwordLungeFrameForCombatant } from '../../src/components/grifball/aiSwordLungeFinishRuntime';
import { executeCustomBotTradeForState } from '../../src/components/grifball/tradeRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import type { TacticalTargetCandidate } from '../../src/components/grifball/combatGeometry';
import { setGrifballCarrierForState, reconcileGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import type { DeathEvent } from '../../src/types';
import { withSimulationRandom, seededRandom } from '../../src/game/simulationRandom';

const noop = () => {};
function lungeFixture() {
  const f = createBotParityFixture();
  const { bot, target, state, refs, map } = f;
  bot.activeWeapon = 'sword'; bot.aiState = 'LUNGING';
  const outcomes: string[] = [], deaths: DeathEvent[] = [];
  const recordDeathEvent = (attacker: string, victim: string): DeathEvent => {
    const event = { id: `${deaths.length}`, attacker, victim }; deaths.push(event); return event;
  };
  triggerCombatantLungeAction({ self: bot, settings: state.settings, lungeDir: new THREE.Vector3(0, 0, 1),
    pos: bot.pos, vel: bot.vel, playDash: noop });
  const flight = (dt = 1 / 60) => {
    if (!bot.isLunging) return;
    const snapshot: TacticalTargetCandidate = { id: target.id, hp: target.hp, maxHp: target.maxHp,
      activeWeapon: target.activeWeapon === 'sword' ? 'sword' : 'hammer', weaponState: target.weaponState,
      isLunging: !!target.isLunging, invulnerabilityTimer: target.invulnerabilityTimer,
      isCrouching: !!target.isCrouching, playerName: target.playerName, modelType: target.modelType, pos: target.pos, vel: target.vel };
    return resolveAISwordLungeFlightForCombatant({ state, self: bot, target: snapshot, mainAi: undefined,
      botId: bot.id, botMesh: refs.otherPlayerMeshes.get(bot.id)!.group, pos: bot.pos, vel: bot.vel, dt,
      cooldownMult: 1, activeCustomMap: map, gravityAcceleration: 18, recoverCombatantAltitude: () => false,
      constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }),
      areCombatantsHostile: () => bot.team !== target.team,
      finishSwordLunge: (cooldownMultiplier, outcome, targetId) => {
        outcomes.push(outcome);
        const result = finishAISwordLungeFrameForCombatant({ state, self: bot, botId: bot.id, pos: bot.pos, vel: bot.vel,
          aiState: bot.aiState, timer: bot.aiTimer ?? 0, weaponState: bot.weaponState, cooldownMultiplier, outcome, targetId,
          recordCombatantObservation: noop, recordBotDamageTag: noop, tryEnterPressureState: () => false, tryStartComboOnHit: noop });
        bot.aiState = result.aiState; bot.aiTimer = result.timer;
      },
      executeCustomBotTrade: (attackerBot, tradeTarget, reason) => executeCustomBotTradeForState({ state, attackerBot,
        target: tradeTarget, reason, rosterCombatant: id => state.otherPlayers.get(id), evaluatePlayerKillMedals: () => [],
        recordDeathEvent, getLocalPlayerFeedName: () => 'Player', playExplosion: noop, playDeath: noop,
        spawnVoxelShockwaveParticles: noop, recordBotCalibrationDeath: noop, pushStatsUpdate: noop }),
      renderSwordLungeTrailVfx: noop, recordPlayerDamageTaken: noop, playExplosion: noop, playDeath: noop,
      spawnVoxelShockwaveParticles: noop, recordDeathEvent, recordBotPsychKill: noop, recordBotCalibrationDeath: noop, pushStatsUpdate: noop });
  };
  return { ...f, flight, outcomes, deaths };
}

test('live lunge damages once, stops on contact, and applies the configured lunge cooldown', () => {
  const f = lungeFixture();
  for (let i = 0; i < 60; i++) { f.flight(); f.visuals(1 / 60); }
  assert.equal(f.target.hp, 19); assert.deepEqual(f.outcomes, ['hit']);
  assert.equal(f.bot.isLunging, false); assert.equal(f.bot.aiState, 'COOLDOWN');
  assert.equal(f.bot.aiTimer, f.state.settings.swordLungeReload); assert.equal(f.bot.vel.length(), 0);
});

test('contact on the timeout tick records a hit once, never overwrites it as a miss', () => {
  const f = lungeFixture(); f.bot.lungeTimer = .8; f.target.pos.z = .5;
  f.flight(); assert.equal(f.target.hp, 19); assert.deepEqual(f.outcomes, ['hit']);
  assert.equal(f.bot.aiLastLungeOutcome, 'hit');
});

test('a shielded target cannot take lunge damage or initiate a trade', () => {
  const f = lungeFixture(); f.target.pos.z = .5; f.target.invulnerabilityTimer = 1;
  f.target.activeWeapon = 'sword'; f.target.weaponState = 'swing_up'; f.state.settings.enableSwordTrade = true;
  f.flight(); assert.equal(f.target.hp, 20); assert.equal(f.bot.hp, f.bot.maxHp);
  assert.equal(f.bot.isLunging, true); assert.deepEqual(f.outcomes, []);
});

test('dead or friendly targets cancel a lunge without damage or a second finish', () => {
  for (const reason of ['dead', 'friendly']) {
    const f = lungeFixture(); f.bot.lungeTimer = .8;
    if (reason === 'dead') f.target.hp = 0; else f.target.team = f.bot.team;
    const hp = f.target.hp; f.flight(); assert.equal(f.target.hp, hp); assert.deepEqual(f.outcomes, ['target_dead']);
  }
});

for (const weapon of ['sword', 'hammer'] as const) test(`live ${weapon} lunge trade damages both once and respawns both after the delay`, () => {
  const f = lungeFixture(); f.target.hp = f.target.maxHp = f.bot.hp = f.bot.maxHp = 1;
  f.target.pos.z = .5; f.target.activeWeapon = weapon; f.target.weaponState = 'swing_up';
  f.state.settings.enableSwordTrade = f.state.settings.enableHammerSwordTrade = true;
  assert.equal(f.flight(), 'trade_return');
  assert.equal(f.target.hp, 0); assert.equal(f.bot.hp, 0);
  assert.equal(f.target.respawnTimer, 3); assert.equal(f.bot.respawnTimer, 3);
  assert.equal(f.bot.kills, 1); assert.equal(f.target.kills, 1); assert.equal(f.deaths.length, 2);
  f.visuals(1 / 60); assert.equal(f.bot.isLunging, false); assert.equal(f.target.weaponState, 'ready');
  for (let i = 0; i < 179; i++) f.respawns(1 / 60);
  assert.equal(f.bot.hp, 0); assert.equal(f.target.hp, 0);
  // Repeated floating-point subtraction can leave a sub-tick remainder at three seconds.
  f.respawns(1 / 60); f.respawns(1 / 60);
  for (const c of [f.bot, f.target]) {
    assert.equal(c.hp, 1); assert.equal(c.respawnTimer, 0); assert.equal(c.aiState, 'APPROACHING');
    assert.equal(c.invulnerabilityTimer, f.state.settings.respawnInvulnerabilityDuration);
    assert.equal(c.weaponState, 'ready'); assert.equal(c.vel.length(), 0);
    assert.ok(c.pos.length() > 2, 'respawn must use the team spawn');
  }
});

test('lethal lunge releases the carrier and shield blocks a fresh melee hit after respawn', () => {
  const f = lungeFixture(); const { state, target, bot, refs } = f;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = target.id;
  setGrifballCarrierForState({ state, id: target.id, carrying: true }); target.hp = 1; target.pos.z = .5;
  withSimulationRandom(seededRandom(1), 1, () => f.flight());
  assert.equal(target.hp, 0); assert.equal(target.respawnTimer, 3); assert.equal(bot.kills, 1);
  reconcileGrifballCarrierForState({ state, refs, ballMeshRef: { current: null },
    ballChargingRef: { current: false }, ballChargeTimerRef: { current: 0 } });
  assert.equal(state.grifball.ball.holderId, null); assert.equal(state.grifball.ball.state, 'loose');
  f.respawns(3); assert.equal(target.hp, target.maxHp);
  target.pos.copy(bot.pos).add(new THREE.Vector3(0, 0, 1)); const hp = target.hp;
  f.impact(bot.id); assert.equal(target.hp, hp);
  target.invulnerabilityTimer = 0; f.impact(bot.id); assert.equal(target.hp, hp - 1);
});
