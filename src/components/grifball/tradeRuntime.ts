import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type DeathEvent, type MedalInfo } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

export type CombatTradeReason = 'sword_vs_sword' | 'sword_lunge_vs_hammer';

type TradeTarget = { id: string };
type TradeWeapon = 'sword_vs_sword' | 'sword_vs_hammer';

const getTradePresentation = (reason: CombatTradeReason): { text: string; weapon: TradeWeapon } =>
  reason === 'sword_vs_sword'
    ? { text: 'Sword Trade', weapon: 'sword_vs_sword' }
    : { text: 'Lunge/Hammer Trade', weapon: 'sword_vs_hammer' };

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
    weapon?: DeathEvent['weapon']
  ) => DeathEvent;
  getLocalPlayerFeedName: () => string;
  playExplosion: () => void;
  playDeath: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  recordBotCalibrationDeath: (botId: string) => void;
  pushStatsUpdate: () => void;
}): void {
  const { text: tradeText, weapon: tradeWeapon } = getTradePresentation(reason);

  attackerBot.hp = Math.max(0, attackerBot.hp - 1);
  const targetCombatant = target.id === 'player' ? undefined : rosterCombatant(target.id);
  if (target.id === 'player') {
    state.playerHP = Math.max(0, state.playerHP - 1);
  } else if (targetCombatant) {
    targetCombatant.hp = Math.max(0, targetCombatant.hp - 1);
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
      state.scorePlayer += 1;
      state.playerKills += 1;
      const medals = evaluatePlayerKillMedals(attackerBot.id);
      recordDeathEvent(`${getLocalPlayerFeedName()} [${tradeText}]`, attackerBot.playerName, medals, tradeWeapon);
    } else if (targetCombatant) {
      if (targetCombatant.id === MAIN_AI_ID) {
        state.scoreEnemy += 1;
        state.enemyKills += 1;
      } else {
        targetCombatant.score = (targetCombatant.score || 0) + 1;
        targetCombatant.kills = (targetCombatant.kills || 0) + 1;
      }
      recordDeathEvent(
        `${targetCombatant.playerName || (targetCombatant.id === MAIN_AI_ID ? 'Red (AI)' : targetCombatant.id)} [${tradeText}]`,
        attackerBot.playerName,
        undefined,
        tradeWeapon
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
    attackerBot.score = (attackerBot.score || 0) + 1;
    attackerBot.kills = (attackerBot.kills || 0) + 1;
    if (attackerBot.id === MAIN_AI_ID) {
      state.scoreEnemy += 1;
      state.enemyKills += 1;
    }
    recordDeathEvent(`${attackerBot.playerName} [${tradeText}]`, getLocalPlayerFeedName(), undefined, tradeWeapon);
    spawnVoxelShockwaveParticles(state.playerPos, '#3b82f6');
  } else if (targetCombatant && targetCombatant.hp <= 0) {
    targetCombatant.hp = 0;
    targetCombatant.respawnTimer = 3.0;
    if (targetCombatant.controller === 'ai') {
      targetCombatant.aiState = 'RESPAWNING';
    }
    if (targetCombatant.id === MAIN_AI_ID) {
      state.enemyDeaths += 1;
      recordBotCalibrationDeath(targetCombatant.id);
    } else {
      targetCombatant.deaths = (targetCombatant.deaths || 0) + 1;
    }
    attackerBot.score = (attackerBot.score || 0) + 1;
    attackerBot.kills = (attackerBot.kills || 0) + 1;
    if (attackerBot.id === MAIN_AI_ID) {
      state.scoreEnemy += 1;
      state.enemyKills += 1;
    }
    recordDeathEvent(
      `${attackerBot.playerName} [${tradeText}]`,
      targetCombatant.playerName || (targetCombatant.id === MAIN_AI_ID ? 'Red (AI)' : targetCombatant.id),
      undefined,
      tradeWeapon
    );
    spawnVoxelShockwaveParticles(
      new THREE.Vector3(targetCombatant.pos.x, targetCombatant.pos.y, targetCombatant.pos.z),
      '#ef4444'
    );
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
  if (!mainAi) return;

  state.playerHP = Math.max(0, state.playerHP - 1);
  mainAi.hp = Math.max(0, mainAi.hp - 1);

  playExplosion();
  playDeath();

  spawnVoxelShockwaveParticles(state.playerPos, '#3b82f6');
  spawnVoxelShockwaveParticles(mainAi.pos, '#ef4444');

  state.lastStrikePos = mainAi.pos.clone();
  state.lastStrikeTick = 1.2;
  state.lastAIStrikePos = state.playerPos.clone();
  state.lastAIStrikeTick = 1.2;

  if (state.playerHP <= 0) {
    state.playerHP = 0;
    state.playerRespawnTimer = 3.0;
    state.scoreEnemy += 1;
    state.playerDeaths += 1;
    state.enemyKills += 1;
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
  if (mainAi.hp <= 0) {
    mainAi.hp = 0;
    mainAi.aiState = 'RESPAWNING';
    state.enemyRespawnTimer = 3.0;
    state.scorePlayer += 1;
    state.playerKills += 1;
    state.enemyDeaths += 1;
    recordBotCalibrationDeath(MAIN_AI_ID);
    playerMedals = evaluatePlayerKillMedals(MAIN_AI_ID);
  }
  mainAi.weaponState = 'ready';
  mainAi.weaponTimer = 0;

  const { text: attackerText, weapon: tradeWeapon } = getTradePresentation(reason);
  const newDeath1: DeathEvent = {
    id: Math.random().toString(36).substring(2, 9),
    attacker: `Blue (You) [${attackerText}]`,
    victim: 'Red (AI)',
    medals: playerMedals,
    weapon: tradeWeapon,
  };
  const newDeath2: DeathEvent = {
    id: Math.random().toString(36).substring(2, 9),
    attacker: `Red (AI) [${attackerText}]`,
    victim: 'Blue (You)',
    weapon: tradeWeapon,
  };

  state.lastDeaths = [newDeath1, newDeath2, ...state.lastDeaths].slice(0, 3);

  pushStatsUpdate();
}
