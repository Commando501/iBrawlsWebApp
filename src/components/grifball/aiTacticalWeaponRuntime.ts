import * as THREE from 'three';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import {
  type AILungeMemory,
  evaluateAICombatDecision,
  type PlayerModelSnapshot,
} from '../../game/aiCombatDecision';
import { type AIMatchScoreContext } from '../../game/aiTuning';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant } from '../../types';
import { type TacticalTargetCandidate } from './combatGeometry';
import { getPressureMatchMultipliers } from './matchPressure';
import { type GrifballRuntimeState } from './runtimeState';

export type TacticalWeaponChoiceContext = {
  distanceToTarget?: number;
  combatDistanceToTarget?: number;
  canStartWeaponAction?: boolean;
  weaponState?: string;
  weaponSwapIQ?: number;
  recentLungeMemory?: AILungeMemory | null;
  weaponPrioritization?: number;
  playerModel?: PlayerModelSnapshot | null;
};

export function evaluateTacticalWeaponChoiceForState({
  state,
  botId,
  target,
  difficulty,
  context = {},
  mainAI,
  pressureAggression,
  scoreContext,
}: {
  state: GrifballRuntimeState;
  botId: string;
  target: TacticalTargetCandidate;
  difficulty: string;
  context?: TacticalWeaponChoiceContext;
  mainAI: Combatant | undefined;
  pressureAggression: number;
  scoreContext: AIMatchScoreContext;
}) {
  const tuning = resolveBehaviorTuning(state.settings);
  const matchMultipliers = getPressureMatchMultipliers(state.settings, scoreContext, pressureAggression);

  if (difficulty === 'easy') {
    return evaluateAICombatDecision({
      difficulty,
      weaponSwapIQ: context.weaponSwapIQ ?? state.settings.aiWeaponSwapIQ ?? 50,
      currentWeapon: 'hammer',
      botHP: 1,
      botMaxHP: 1,
      distanceToTarget: Infinity,
      nearbyEnemiesCount: 0,
      target,
      attackRange: state.settings.attackRange,
      attackRadius: state.settings.attackRadius,
      swordLungeDistance: state.settings.swordLungeDistance ?? 14.5,
      swordLungeSpeed: state.settings.swordLungeSpeed ?? 24.0,
      swordTradeWindowMs: state.settings.swordTradeWindow ?? 350,
      canStartWeaponAction: false,
      weaponState: 'ready',
      weaponPrioritization: context.weaponPrioritization ?? 50,
      playerModel: context.playerModel,
      matchMultipliers,
      mechanicAwareIq: tuning.mechanicAwareIq,
      highIqOverride: tuning.highIqOverride,
      hammerWindupSeconds: tuning.hammerWindupSeconds,
    });
  }

  const botState = botId === MAIN_AI_ID ? null : state.otherPlayers.get(botId);
  const currentWeapon = botId === MAIN_AI_ID ? (mainAI?.activeWeapon || 'hammer') : botState?.activeWeapon;
  const botHP = botId === MAIN_AI_ID ? (mainAI?.hp || 1) : botState?.hp || 1;
  const botMaxHP = botId === MAIN_AI_ID ? (mainAI?.maxHp || 1) : botState?.maxHp || 1;
  const botPos = botId === MAIN_AI_ID
    ? (mainAI?.pos || new THREE.Vector3())
    : (botState ? new THREE.Vector3(botState.pos.x, botState.pos.y, botState.pos.z) : new THREE.Vector3());

  const dist = context.distanceToTarget ?? botPos.distanceTo(target.pos);

  let nearbyEnemiesCount = 0;
  if (state.playerHP > 0 && state.playerRespawnTimer <= 0 && !state.isObserverMode && botId !== 'player') {
    if (botPos.distanceTo(state.playerPos) < 6.0) nearbyEnemiesCount++;
  }
  if (botId !== MAIN_AI_ID && mainAI && mainAI.hp > 0 && mainAI.aiState !== 'RESPAWNING') {
    if (botPos.distanceTo(mainAI.pos) < 6.0) nearbyEnemiesCount++;
  }
  if (state.otherPlayers) {
    state.otherPlayers.forEach((other) => {
      if (other.id !== botId && other.hp > 0 && other.respawnTimer <= 0) {
        const otherPos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
        if (botPos.distanceTo(otherPos) < 6.0) nearbyEnemiesCount++;
      }
    });
  }

  return evaluateAICombatDecision({
    difficulty,
    weaponSwapIQ: context.weaponSwapIQ ?? state.settings.aiWeaponSwapIQ ?? 50,
    currentWeapon: (currentWeapon ?? 'hammer') as 'hammer' | 'sword',
    botHP,
    botMaxHP,
    distanceToTarget: dist,
    combatDistanceToTarget: context.combatDistanceToTarget,
    nearbyEnemiesCount,
    target: {
      id: target.id,
      hp: target.hp,
      activeWeapon: target.activeWeapon,
      weaponState: target.weaponState,
      isLunging: target.isLunging,
      invulnerabilityTimer: target.invulnerabilityTimer,
      dashCooldownRemaining: target.dashCooldownRemaining,
      swapLockoutRemaining: target.swapLockoutRemaining,
    },
    attackRange: state.settings.attackRange,
    attackRadius: state.settings.attackRadius,
    swordLungeDistance: state.settings.swordLungeDistance ?? 14.5,
    swordLungeSpeed: state.settings.swordLungeSpeed ?? 24.0,
    swordTradeWindowMs: state.settings.swordTradeWindow ?? 350,
    canStartWeaponAction: context.canStartWeaponAction ?? true,
    weaponState: context.weaponState ?? 'ready',
    recentLungeMemory: context.recentLungeMemory,
    weaponPrioritization: context.weaponPrioritization ?? 50,
    playerModel: context.playerModel,
    matchMultipliers,
    mechanicAwareIq: tuning.mechanicAwareIq,
    highIqOverride: tuning.highIqOverride,
    hammerWindupSeconds: tuning.hammerWindupSeconds,
  });
}
