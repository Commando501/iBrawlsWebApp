import { creditCombatKillForState } from './combatScoring';
import { recordPlayerMeleeKillForState } from './playerMeleeDeathRuntime';
import { resolveCombatHitDamageForState } from './combatDamage';
import { simulationTimestamp } from '../../game/simulationRandom';
import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type DeathEvent, type MedalInfo } from '../../types';
import {
  createReplayHeatmapCombatantSource,
  queueReplayHeatmapDeathEventsForState,
  type ReplayHeatmapCombatantSource,
} from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import {
  recordCombatantCounterSuccessObservation,
  recordCombatantDamageDealtObservation,
  recordCombatantDamageReceivedObservation,
} from './playerModelObservations';

export type CombatTradeReason = 'sword_vs_sword' | 'sword_lunge_vs_hammer';

type TradeTarget = { id: string };
type TradeWeapon = 'sword_vs_sword' | 'sword_vs_hammer';

const getTradePresentation = (reason: CombatTradeReason): { text: string; weapon: TradeWeapon } =>
  reason === 'sword_vs_sword'
    ? { text: 'Sword Trade', weapon: 'sword_vs_sword' }
    : { text: 'Lunge/Hammer Trade', weapon: 'sword_vs_hammer' };

export function resolveSwordLungeTradeReasonForState({
  state,
  target,
  mainAi,
}: {
  state: GrifballRuntimeState;
  target: TradeTarget;
  mainAi?: Combatant;
}): CombatTradeReason | null {
  const swordThreshold = state.settings.swordTradeWindow ?? 350;
  const hammerThreshold = state.settings.hammerSwordTradeWindow ?? 350;
  const now = simulationTimestamp();
  const recent = (time: number | undefined, window: number) =>
    typeof time === 'number' && Number.isFinite(time) && time > 0 && now >= time && now - time <= window;

  if (target.id === 'player') {
    if (state.settings.enableSwordTrade && state.activeWeapon === 'sword' && (
      state.isLunging ||
      state.pSwordState === 'slashing' ||
      recent(state.lastPlayerSwordAttackTime, swordThreshold)
    )) {
      return 'sword_vs_sword';
    }
    if (state.settings.enableHammerSwordTrade && state.activeWeapon === 'hammer' && (
      state.pWeaponState === 'swing_up' ||
      state.pWeaponState === 'swing_down' ||
      recent(state.lastPlayerHammerAttackTime, hammerThreshold)
    )) {
      return 'sword_lunge_vs_hammer';
    }
    return null;
  }

  // All roster slots use the same live flight flag and weapon-specific history.
  // Zero is the factory's no-attack sentinel; a future timestamp is not a counter.
  const targetBot = target.id === MAIN_AI_ID ? mainAi : state.otherPlayers.get(target.id);
  if (!targetBot) return null;
  if (state.settings.enableSwordTrade && targetBot.activeWeapon === 'sword' && (
    targetBot.isLunging || targetBot.weaponState === 'swing_up' || targetBot.weaponState === 'swing_down' ||
    recent(targetBot.lastSwordAttackTime, swordThreshold)
  )) return 'sword_vs_sword';
  if (state.settings.enableHammerSwordTrade && targetBot.activeWeapon === 'hammer' && (
    targetBot.weaponState === 'swing_up' || targetBot.weaponState === 'swing_down' ||
    recent(targetBot.lastHammerAttackTime, hammerThreshold)
  )) return 'sword_lunge_vs_hammer';
  return null;
}

export function executeCustomBotTradeForState({
  state,
  attackerBot,
  target,
  reason = 'sword_vs_sword',
  rosterCombatant,
  evaluatePlayerKillMedals,
  recordDeathEvent,
  getLocalPlayerFeedName,
  playExplosion,
  playDeath,
  spawnVoxelShockwaveParticles,
  recordBotCalibrationDeath,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  attackerBot: Combatant;
  target: TradeTarget;
  reason?: CombatTradeReason;
  rosterCombatant: (id: string) => Combatant | undefined;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  recordDeathEvent: (
    attacker: string,
    victim: string,
    medals?: MedalInfo[],
    weapon?: DeathEvent['weapon'],
    heatmap?: {
      attacker: ReplayHeatmapCombatantSource;
      victim: ReplayHeatmapCombatantSource;
    }
  ) => DeathEvent;
  getLocalPlayerFeedName: () => string;
  playExplosion: () => void;
  playDeath: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  recordBotCalibrationDeath: (botId: string) => void;
  pushStatsUpdate: () => void;
}): void {
  const { text: tradeText, weapon: tradeWeapon } = getTradePresentation(reason);

  attackerBot.hp = Math.max(0, attackerBot.hp - resolveCombatHitDamageForState(
    state, attackerBot.id, attackerBot.hp, reason === 'sword_vs_sword' ? 'sword' : 'hammer'
  ));
  const targetCombatant = target.id === 'player' ? undefined : rosterCombatant(target.id);
  if (target.id === 'player') {
    state.playerHP = Math.max(0, state.playerHP - resolveCombatHitDamageForState(state, 'player', state.playerHP, 'sword'));
  } else if (targetCombatant) {
    targetCombatant.hp = Math.max(0, targetCombatant.hp - resolveCombatHitDamageForState(state, targetCombatant.id, targetCombatant.hp, 'sword'));
    recordCombatantDamageDealtObservation(state, attackerBot.id);
    recordCombatantDamageReceivedObservation(state, attackerBot.id);
    recordCombatantDamageDealtObservation(state, targetCombatant.id);
    recordCombatantDamageReceivedObservation(state, targetCombatant.id);
    recordCombatantCounterSuccessObservation(state, targetCombatant.id);
  }

  playExplosion();
  playDeath();

  if (attackerBot.hp <= 0) {
    attackerBot.hp = 0;
    attackerBot.respawnTimer = 3.0;
    attackerBot.deaths = (attackerBot.deaths || 0) + 1;
    if (attackerBot.id === MAIN_AI_ID) {
      state.enemyDeaths += 1;
      recordBotCalibrationDeath(attackerBot.id);
    }

    if (target.id === 'player') {
      creditCombatKillForState(state, 'player', attackerBot.id);
      const medals = evaluatePlayerKillMedals(attackerBot.id);
      recordDeathEvent(`${getLocalPlayerFeedName()} [${tradeText}]`, attackerBot.playerName, medals, tradeWeapon, {
        attacker: createReplayHeatmapCombatantSource('player', undefined, {
          team: state.localPlayerTeam,
          pos: state.playerPos,
        }),
        victim: createReplayHeatmapCombatantSource(attackerBot.id, attackerBot),
      });
    } else if (targetCombatant) {
      creditCombatKillForState(state, targetCombatant.id, attackerBot.id);
      recordDeathEvent(
        `${targetCombatant.playerName || (targetCombatant.id === MAIN_AI_ID ? 'Red (AI)' : targetCombatant.id)} [${tradeText}]`,
        attackerBot.playerName,
        undefined,
        tradeWeapon,
        {
          attacker: createReplayHeatmapCombatantSource(targetCombatant.id, targetCombatant),
          victim: createReplayHeatmapCombatantSource(attackerBot.id, attackerBot),
        }
      );
    }
    spawnVoxelShockwaveParticles(
      new THREE.Vector3(attackerBot.pos.x, attackerBot.pos.y, attackerBot.pos.z),
      '#ef4444'
    );
  }

  if (target.id === 'player' && state.playerHP <= 0) {
    state.playerHP = 0;
    state.playerRespawnTimer = 3.0;
    state.playerDeaths += 1;
    creditCombatKillForState(state, attackerBot.id, target.id, attackerBot);
    recordDeathEvent(`${attackerBot.playerName} [${tradeText}]`, getLocalPlayerFeedName(), undefined, tradeWeapon, {
      attacker: createReplayHeatmapCombatantSource(attackerBot.id, attackerBot),
      victim: createReplayHeatmapCombatantSource('player', undefined, {
        team: state.localPlayerTeam,
        pos: state.playerPos,
      }),
    });
    spawnVoxelShockwaveParticles(state.playerPos, '#3b82f6');
  } else if (targetCombatant && targetCombatant.hp <= 0) {
    targetCombatant.hp = 0;
    targetCombatant.respawnTimer = 3.0;
    targetCombatant.deaths = (targetCombatant.deaths || 0) + 1;
    if (targetCombatant.controller === 'ai') {
      targetCombatant.aiState = 'RESPAWNING';
    }
    if (targetCombatant.id === MAIN_AI_ID) {
      state.enemyDeaths += 1;
      recordBotCalibrationDeath(targetCombatant.id);
    }
    creditCombatKillForState(state, attackerBot.id, target.id, attackerBot);
    recordDeathEvent(
      `${attackerBot.playerName} [${tradeText}]`,
      targetCombatant.playerName || (targetCombatant.id === MAIN_AI_ID ? 'Red (AI)' : targetCombatant.id),
      undefined,
      tradeWeapon,
      {
        attacker: createReplayHeatmapCombatantSource(attackerBot.id, attackerBot),
        victim: createReplayHeatmapCombatantSource(targetCombatant.id, targetCombatant),
      }
    );
    spawnVoxelShockwaveParticles(
      new THREE.Vector3(targetCombatant.pos.x, targetCombatant.pos.y, targetCombatant.pos.z),
      '#ef4444'
    );
  }

  // A trade has already applied the defender's committed swing. Consume that
  // impact so a survivor cannot hit again when the animation reaches its strike.
  if (target.id === 'player') {
    if (state.playerHP <= 0) {
      state.pSwordState = state.pWeaponState = 'ready';
      state.pSwordTimer = state.pWeaponTimer = 0;
      state.pSwordReady = state.pWeaponReady = true;
      state.isLunging = false; state.lungeTimer = 0;
    } else if (state.activeWeapon === 'sword' && (state.isLunging || state.pSwordState === 'slashing')) {
      state.pSwordRecoverDuration = state.isLunging ? state.settings.swordLungeReload : state.settings.swordSlashReload;
      state.isLunging = false; state.lungeTimer = 0;
      state.pSwordState = 'recovering'; state.pSwordTimer = 0; state.pSwordReady = false;
    } else if (state.activeWeapon === 'hammer' && (state.pWeaponState === 'swing_up' || state.pWeaponState === 'swing_down')) {
      state.pWeaponState = 'recovering'; state.pWeaponTimer = 0; state.pWeaponReady = false;
    }
  }
  if (targetCombatant && targetCombatant.hp > 0 && !targetCombatant.isLunging &&
    (targetCombatant.weaponState === 'swing_up' || targetCombatant.weaponState === 'swing_down')) {
    targetCombatant.weaponState = 'recovering';
    targetCombatant.weaponTimer = 0;
    if (targetCombatant.hammerJumpPlanned !== undefined) targetCombatant.hammerJumpPlanned = false;
    targetCombatant.hammerJumpType = undefined;
  }
  attackerBot.isLunging = false;
  attackerBot.weaponState = 'ready';
  pushStatsUpdate();
}

export function executeMainAITradeForState({
  state,
  mainAi,
  reason,
  evaluatePlayerKillMedals,
  recordBotCalibrationDeath,
  playExplosion,
  playDeath,
  spawnVoxelShockwaveParticles,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  mainAi: Combatant | undefined;
  reason: CombatTradeReason;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  recordBotCalibrationDeath: (botId: string) => void;
  playExplosion: () => void;
  playDeath: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  pushStatsUpdate: () => void;
}): void {
  executePlayerCombatantTradeForState({ state, combatant: mainAi, reason, evaluatePlayerKillMedals,
    recordBotCalibrationDeath, playExplosion, playDeath, spawnVoxelShockwaveParticles, pushStatsUpdate });
}

export function executePlayerCombatantTradeForState({
  state,
  combatant,
  reason,
  evaluatePlayerKillMedals,
  recordBotCalibrationDeath,
  playExplosion,
  playDeath,
  spawnVoxelShockwaveParticles,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  combatant: Combatant | undefined;
  reason: CombatTradeReason;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  recordBotCalibrationDeath: (botId: string) => void;
  playExplosion: () => void;
  playDeath: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  pushStatsUpdate: () => void;
}): void {
  if (!combatant || combatant.hp <= 0 || state.playerHP <= 0) return;

  // A committed sword lunge can finish after picking up the ball.
  const playerUsesSword = reason === 'sword_vs_sword' || state.isLunging || state.activeWeapon === 'sword';
  state.playerHP = Math.max(0, state.playerHP - resolveCombatHitDamageForState(
    state, 'player', state.playerHP, reason === 'sword_vs_sword' || !playerUsesSword ? 'sword' : 'hammer'
  ));
  combatant.hp = Math.max(0, combatant.hp - resolveCombatHitDamageForState(
    state, combatant.id, combatant.hp, playerUsesSword ? 'sword' : 'hammer'
  ));

  playExplosion();
  playDeath();

  spawnVoxelShockwaveParticles(state.playerPos, '#3b82f6');
  spawnVoxelShockwaveParticles(combatant.pos, '#ef4444');

  state.lastStrikePos = combatant.pos.clone();
  state.lastStrikeTick = 1.2;
  state.lastAIStrikePos = state.playerPos.clone();
  state.lastAIStrikeTick = 1.2;

  if (state.playerHP <= 0) {
    state.playerHP = 0;
    state.playerRespawnTimer = 3.0;
    state.playerDeaths += 1;
    creditCombatKillForState(state, combatant.id, 'player', combatant);
  }
  state.pWeaponState = 'ready';
  state.pWeaponTimer = 0;
  state.pWeaponReady = true;
  state.pSwordState = 'ready';
  state.pSwordTimer = 0;
  state.pSwordReady = true;
  state.isLunging = false;
  state.lungeTimer = 0;

  let playerMedals: MedalInfo[] | undefined = undefined;
  if (combatant.hp <= 0) {
    recordPlayerMeleeKillForState(state, combatant, recordBotCalibrationDeath);
    playerMedals = evaluatePlayerKillMedals(combatant.id);
  }
  if (combatant.hp > 0 && combatant.isLunging) {
    // Player contact consumes the roster flight before its next physics update.
    // Stop flight momentum and enter reload just as a roster-initiated trade does.
    combatant.vel.x = combatant.vel.z = 0;
    combatant.vel.y = Math.min(combatant.vel.y, 0);
    combatant.isJumping = combatant.pos.y > .01 || Math.abs(combatant.vel.y) > .01;
    combatant.aiState = 'COOLDOWN';
    combatant.aiTimer = state.settings.swordLungeReload ?? 1.2;
  }
  combatant.isLunging = false;
  combatant.weaponState = 'ready';
  combatant.weaponTimer = 0;
  if (combatant.hammerJumpPlanned !== undefined) combatant.hammerJumpPlanned = false;
  combatant.hammerJumpType = undefined;

  const { text: attackerText, weapon: tradeWeapon } = getTradePresentation(reason);
  const playerName = state.settings.playerName || 'Blue (You)';
  const botName = combatant.playerName || 'Red (AI)';
  const newDeath1: DeathEvent = {
    id: Math.random().toString(36).substring(2, 9),
    attacker: `${playerName} [${attackerText}]`,
    victim: botName,
    medals: playerMedals,
    weapon: tradeWeapon,
  };
  const newDeath2: DeathEvent = {
    id: Math.random().toString(36).substring(2, 9),
    attacker: `${botName} [${attackerText}]`,
    victim: playerName,
    weapon: tradeWeapon,
  };

  state.lastDeaths = [
    ...(combatant.hp <= 0 ? [newDeath1] : []),
    ...(state.playerHP <= 0 ? [newDeath2] : []),
    ...state.lastDeaths,
  ].slice(0, 3);
  if (combatant.hp <= 0) {
    queueReplayHeatmapDeathEventsForState({
      state,
      attacker: createReplayHeatmapCombatantSource('player', undefined, {
        team: state.localPlayerTeam,
        pos: state.playerPos,
      }),
      victim: createReplayHeatmapCombatantSource(combatant.id, combatant),
      weapon: tradeWeapon,
    });
  }
  if (state.playerHP <= 0) {
    queueReplayHeatmapDeathEventsForState({
      state,
      attacker: createReplayHeatmapCombatantSource(combatant.id, combatant),
      victim: createReplayHeatmapCombatantSource('player', undefined, {
        team: state.localPlayerTeam,
        pos: state.playerPos,
      }),
      weapon: tradeWeapon,
    });
  }

  pushStatsUpdate();
}
