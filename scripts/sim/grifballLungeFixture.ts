import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { resolveAISwordLungeFlightForCombatant } from '../../src/components/grifball/aiSwordLungeFlightRuntime';
import { finishAISwordLungeFrameForCombatant } from '../../src/components/grifball/aiSwordLungeFinishRuntime';
import { executeCustomBotTradeForState } from '../../src/components/grifball/tradeRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import type { TacticalTargetCandidate } from '../../src/components/grifball/combatGeometry';
import type { DeathEvent } from '../../src/types';
import { recordCombatantModelObservation } from '../../src/components/grifball/playerModelObservations';

const noop = () => {};
export function lungeFixture(id = 'bot_2', observer = true, targetId = 'target') {
  const f = createBotParityFixture(id, observer, {}, targetId);
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
    return resolveAISwordLungeFlightForCombatant({ state, self: bot, target: snapshot, mainAi: state.otherPlayers.get('main_ai'),
      botId: bot.id, botMesh: refs.otherPlayerMeshes.get(bot.id)!.group, pos: bot.pos, vel: bot.vel, dt,
      cooldownMult: 1, activeCustomMap: map, gravityAcceleration: 18, recoverCombatantAltitude: () => false,
      constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }),
      areCombatantsHostile: () => bot.team !== target.team,
      finishSwordLunge: (cooldownMultiplier, outcome, targetId, damageAlreadyRecorded) => {
        outcomes.push(outcome);
        const result = finishAISwordLungeFrameForCombatant({ state, self: bot, botId: bot.id, pos: bot.pos, vel: bot.vel,
          aiState: bot.aiState, timer: bot.aiTimer ?? 0, weaponState: bot.weaponState, cooldownMultiplier, outcome, targetId, damageAlreadyRecorded,
          recordCombatantObservation: (id, observe) => recordCombatantModelObservation(state, id, observe),
          recordBotDamageTag: noop, tryEnterPressureState: () => false, tryStartComboOnHit: noop });
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

